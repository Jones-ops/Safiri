-- Slice 3b (Instalments): paying instalments, reminders, missed payments and cancellation.

-- Payments can now be an instalment, or the whole remaining balance.
alter table public.payments drop constraint payments_purpose_check;
alter table public.payments add constraint payments_purpose_check
  check (purpose in ('deposit', 'full', 'instalment', 'balance', 'share'));

-- Reminders are sent once per instalment, kind and channel (the job can run many times a day).
alter table public.notifications
  add column instalment_id uuid references public.instalments (id) on delete cascade,
  add column kind text;  -- reminder_3d / reminder_1d / overdue / cancelled / payment_received / refund_due
create unique index notifications_once_idx on public.notifications (instalment_id, kind, channel)
  where instalment_id is not null;

-- Expo push tokens, so reminders reach the app. One row per device.
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  disabled_at timestamptz  -- set when Expo says the device no longer accepts pushes
);
create index push_tokens_user_idx on public.push_tokens (user_id) where disabled_at is null;
alter table public.push_tokens enable row level security;
grant all on public.push_tokens to service_role;
create trigger set_updated_at before update on public.push_tokens for each row execute function private.set_updated_at();

-- Cancels a confirmed booking: gives its rooms back, stops the plan, and records the refund the
-- policy allows (worked out by the API from the cancellation policy). Idempotent.
create function public.cancel_booking(p_booking_id uuid, p_reason text, p_refund_kes integer)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype;
  v_payment_id uuid;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found'; end if;
  if b.status = 'cancelled' then return 'already_cancelled'; end if;
  if b.status not in ('confirmed', 'fully_paid') then raise exception 'not_cancellable'; end if;
  if p_refund_kes < 0 or p_refund_kes > b.paid_kes then raise exception 'invalid_refund'; end if;

  -- Rooms go back on sale (same lock order as holds).
  perform 1
  from public.availability a
  join public.booking_items bi on bi.listing_id = a.listing_id and bi.date = a.date
  where bi.booking_id = p_booking_id
  order by a.listing_id, a.date
  for update of a;
  update public.availability a
  set units_booked = a.units_booked - n.units
  from (
    select listing_id, date, sum(units)::int as units
    from public.booking_items where booking_id = p_booking_id group by listing_id, date
  ) n
  where a.listing_id = n.listing_id and a.date = n.date;

  update public.instalments set status = 'cancelled' where booking_id = p_booking_id and status in ('due', 'overdue');
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_booking_id;

  if p_refund_kes > 0 then
    select id into v_payment_id from public.payments
    where booking_id = p_booking_id and status = 'succeeded' order by confirmed_at desc limit 1;
    insert into public.refunds (booking_id, payment_id, amount_kes, msisdn, status, reason)
    values (p_booking_id, v_payment_id, p_refund_kes, b.phone, 'pending', p_reason);
  end if;
  return 'cancelled';
end $$;

revoke execute on function public.cancel_booking(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, text, integer) to service_role;
