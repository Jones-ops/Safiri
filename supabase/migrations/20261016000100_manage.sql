-- Managing the catalogue (admin and agencies) and provider self-service.
--
-- All writes go through the API (service role), which checks roles from profiles.roles and
-- stamps the acting user into the audit log (see private.audit, which reads request.jwt.claims).
-- App users still read through RLS: agencies already see their own draft packages.

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('admin');
$$;

-- Admins see every package, booking and provider in the app's direct reads too.
create policy "admins see every package" on public.packages for select to authenticated using (private.is_admin());
create policy "admins see every booking" on public.bookings for select to authenticated using (private.is_admin());
create policy "admins see every provider" on public.providers for select to authenticated using (private.is_admin());
create policy "admins see every agency" on public.agencies for select to authenticated using (private.is_admin());

-- Providers who answer requests in the app (not auto-accepted) and their onboarding progress.
alter table public.providers
  add column onboarding_step smallint not null default 6 check (onboarding_step between 0 and 6),
  add column location_name text,
  add column photos text[] not null default '{}';

-- A listing's own availability rows exist for 180 days ahead (seed); providers block days.
alter table public.availability add column blocked boolean not null default false;
alter table public.availability drop constraint availability_not_oversold;
alter table public.availability add constraint availability_not_oversold
  check (units_held + units_booked <= case when blocked then units_held + units_booked else units_total end);

-- Packages remember who last changed them (the audit log has the full history).
alter table public.packages add column updated_by uuid references auth.users (id);

-- Provider payouts: what each provider is owed, derived (never edited): their net on completed
-- trips (declined items earn nothing) minus what has already been paid out.
create view private.provider_balances as
  select pr.id as provider_id,
         (coalesce((select sum(bi.net_kes) from public.booking_items bi join public.bookings b on b.id = bi.booking_id
                    where bi.provider_id = pr.id and b.status = 'completed' and bi.provider_status <> 'declined'), 0)
          - coalesce((select sum(po.amount_kes) from public.payouts po where po.provider_id = pr.id and po.status = 'paid'), 0))::int as owed_kes
  from public.providers pr;
