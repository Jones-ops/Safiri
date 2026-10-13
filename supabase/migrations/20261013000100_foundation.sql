-- Safiri foundation: helper schema, enums, shared trigger functions and the audit log.
-- Conventions for every table: uuid id, created_at, updated_at; money is integer KES;
-- RLS is on everywhere (see the _rls migration). Keep enums in step with packages/shared.

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- New tables in public start with no access for app users; each grant is explicit.
alter default privileges in schema public revoke all on tables from anon, authenticated;

create type public.user_role as enum ('traveller', 'provider', 'agency', 'admin');
create type public.consent_purpose as enum ('booking', 'notifications', 'analytics', 'marketing');
create type public.provider_type as enum ('lodge', 'guide', 'driver', 'activity');
create type public.listing_kind as enum ('stay', 'activity', 'transport');
create type public.listing_unit as enum ('night', 'person', 'day');
create type public.link_status as enum ('pending', 'active', 'ended');
create type public.publish_status as enum ('draft', 'published', 'unpublished');
create type public.booking_status as enum ('draft', 'held', 'confirmed', 'fully_paid', 'completed', 'expired', 'cancelled');
create type public.provider_item_status as enum ('pending', 'accepted', 'declined', 'auto_accepted');
create type public.instalment_status as enum ('due', 'paid', 'overdue', 'waived', 'cancelled');
create type public.mandate_status as enum ('pending', 'active', 'paused', 'cancelled', 'failed');
create type public.payment_status as enum ('initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'timed_out');
create type public.member_status as enum ('invited', 'paid', 'removed');
create type public.payout_status as enum ('scheduled', 'processing', 'paid', 'failed');
create type public.refund_status as enum ('pending', 'processing', 'paid', 'failed');
create type public.money_method as enum ('mpesa_b2c', 'bank');
create type public.notification_channel as enum ('push', 'whatsapp', 'sms');
create type public.notification_status as enum ('queued', 'sent', 'delivered', 'failed', 'read');
create type public.media_kind as enum ('photo', 'clip');
create type public.upload_status as enum ('pending', 'uploading', 'complete', 'failed');
create type public.review_status as enum ('published', 'hidden');

-- Kenyan mobile number in stored form: 2547XXXXXXXX or 2541XXXXXXXX.
create domain public.msisdn as text check (value ~ '^254(7|1)[0-9]{8}$');

create function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Used on tables whose rows must never change once written (ledger, audit log).
create function private.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'restrict_violation';
end $$;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  actor uuid,          -- auth user id; null for the API's service role and jobs
  actor_role text,     -- anon / authenticated / service_role / postgres
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);
create index audit_log_actor_idx on public.audit_log (actor, created_at desc);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.forbid_change();

-- Records who changed what and when. Attached to money and booking tables in the _rls migration.
create function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  insert into public.audit_log (actor, actor_role, action, entity, entity_id, before, after)
  values (
    nullif(claims ->> 'sub', '')::uuid,
    coalesce(claims ->> 'role', session_user::text),
    tg_op,
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end $$;
