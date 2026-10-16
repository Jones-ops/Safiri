-- Slice 5 (Provider and Agency) and cancel/refund: provider requests, payouts, refunds and
-- what happens to the money when a trip ends or is cancelled.

-- A request a provider never answered.
alter type public.provider_item_status add value if not exists 'expired';

-- Daraja B2C results (payouts and refunds) arrive on separate callbacks; keep them raw.
create table public.mpesa_b2c_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  conversation_id text,
  body jsonb not null,
  outcome text
);
create index mpesa_b2c_results_conversation_idx on public.mpesa_b2c_results (conversation_id);
alter table public.mpesa_b2c_results enable row level security;
grant all on public.mpesa_b2c_results to service_role;
create trigger mpesa_b2c_results_append_only before delete on public.mpesa_b2c_results
  for each row execute function private.forbid_change();

alter table public.payouts add column mpesa_receipt text, add column booking_ids uuid[] not null default '{}';
alter table public.refunds add column mpesa_receipt text;

-- Short signed codes for the SMS fallback of a provider request ("Accept: https://.../r/<code>").
alter table public.booking_items add column request_sent_at timestamptz;

-- When a trip ends, the traveller's prepayment becomes provider, agency and platform money.
-- Idempotent: a booking is recognised once.
create function public.complete_booking(p_booking_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype;
  q record;
  v_net integer;
  v_margin integer;
  v_fee integer;
  v_txn uuid := gen_random_uuid();
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found'; end if;
  if b.status = 'completed' then return 'already_completed'; end if;
  if b.status <> 'fully_paid' then raise exception 'not_fully_paid'; end if;

  select coalesce(sum(net_kes), 0)::int into v_net from public.booking_items where booking_id = b.id and provider_status <> 'declined';
  -- The agency's share and the platform fee are whatever is left of the price, split as the quote was.
  select (breakdown -> 'perPerson' ->> 'marginKes')::int * b.travellers as margin into q from public.quotes where id = b.quote_id;
  v_margin := least(coalesce(q.margin, 0), b.total_kes - v_net);
  v_fee := b.total_kes - v_net - v_margin;

  insert into public.ledger_entries (txn_id, account, debit_kes, credit_kes, booking_id, ref_type, ref_id, memo)
  select v_txn, x.account, x.debit, x.credit, b.id, 'recognise', b.id, b.ref
  from (values ('traveller_prepayments', b.total_kes, 0), ('provider_payable', 0, v_net), ('agency_payable', 0, v_margin), ('platform_revenue', 0, v_fee)) as x(account, debit, credit)
  where x.debit > 0 or x.credit > 0;

  update public.bookings set status = 'completed', completed_at = now() where id = b.id;
  return 'completed';
end $$;

-- Cancelling now also moves the money: the refund becomes payable, the rest is kept as revenue.
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text, p_refund_kes integer)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype;
  v_payment_id uuid;
  v_kept integer;
  v_txn uuid := gen_random_uuid();
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found'; end if;
  if b.status = 'cancelled' then return 'already_cancelled'; end if;
  if b.status not in ('confirmed', 'fully_paid') then raise exception 'not_cancellable'; end if;
  if p_refund_kes < 0 or p_refund_kes > b.paid_kes then raise exception 'invalid_refund'; end if;

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

  v_kept := b.paid_kes - p_refund_kes;
  if b.paid_kes > 0 then
    insert into public.ledger_entries (txn_id, account, debit_kes, credit_kes, booking_id, ref_type, ref_id, memo)
    select v_txn, x.account, x.debit, x.credit, b.id, 'cancel', b.id, p_reason
    from (values ('traveller_prepayments', b.paid_kes, 0), ('refunds_payable', 0, p_refund_kes), ('platform_revenue', 0, v_kept)) as x(account, debit, credit)
    where x.debit > 0 or x.credit > 0;
  end if;

  if p_refund_kes > 0 then
    select id into v_payment_id from public.payments
    where booking_id = p_booking_id and status = 'succeeded' order by confirmed_at desc limit 1;
    insert into public.refunds (booking_id, payment_id, amount_kes, msisdn, status, reason)
    values (p_booking_id, v_payment_id, p_refund_kes, b.phone, 'pending', p_reason);
  end if;
  return 'cancelled';
end $$;

-- A refund has been paid out by M-PESA: the liability is settled from client funds.
create function public.settle_refund(p_refund_id uuid, p_receipt text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  v_txn uuid := gen_random_uuid();
begin
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'refund_not_found'; end if;
  if r.status = 'paid' then return 'already_paid'; end if;
  update public.refunds set status = 'paid', paid_at = now(), mpesa_receipt = p_receipt where id = r.id;
  insert into public.ledger_entries (txn_id, account, debit_kes, credit_kes, booking_id, ref_type, ref_id, memo)
  values (v_txn, 'refunds_payable', r.amount_kes, 0, r.booking_id, 'refund', r.id, p_receipt),
         (v_txn, 'client_funds', 0, r.amount_kes, r.booking_id, 'refund', r.id, p_receipt);
  return 'paid';
end $$;

-- A provider payout has been paid by M-PESA.
create function public.settle_payout(p_payout_id uuid, p_receipt text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  p public.payouts%rowtype;
  v_txn uuid := gen_random_uuid();
begin
  select * into p from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'payout_not_found'; end if;
  if p.status = 'paid' then return 'already_paid'; end if;
  update public.payouts set status = 'paid', paid_at = now(), mpesa_receipt = p_receipt where id = p.id;
  insert into public.ledger_entries (txn_id, account, debit_kes, credit_kes, ref_type, ref_id, memo)
  values (v_txn, case when p.provider_id is not null then 'provider_payable' else 'agency_payable' end, p.amount_kes, 0, 'payout', p.id, p_receipt),
         (v_txn, 'client_funds', 0, p.amount_kes, 'payout', p.id, p_receipt);
  return 'paid';
end $$;

revoke execute on function public.complete_booking(uuid) from public, anon, authenticated;
revoke execute on function public.settle_refund(uuid, text) from public, anon, authenticated;
revoke execute on function public.settle_payout(uuid, text) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.complete_booking(uuid) to service_role;
grant execute on function public.settle_refund(uuid, text) to service_role;
grant execute on function public.settle_payout(uuid, text) to service_role;
grant execute on function public.cancel_booking(uuid, text, integer) to service_role;

-- Providers and agencies see their own payouts (already granted); refunds show on the booking.
grant select (id, created_at, updated_at, booking_id, amount_kes, method, status, reason, paid_at, mpesa_receipt) on public.refunds to authenticated;
