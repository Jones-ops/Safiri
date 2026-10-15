-- Slice 3a (Pay once): M-PESA STK push payments, confirmation, ledger and payment plans.
--
-- Daraja callbacks are unsigned. The API only calls confirm_payment() for a callback that
-- matches a payment it started AND that an STK Query to Safaricom confirms. confirm_payment()
-- is idempotent: a replayed callback finds the payment already succeeded and changes nothing.

alter table public.payments
  add column purpose text not null default 'deposit' check (purpose in ('deposit', 'full', 'instalment', 'share')),
  add column schedule jsonb;  -- for deposit/full: the payment schedule the traveller chose at checkout

-- Every callback Daraja sends, kept raw for reconciliation and disputes (append-only).
create table public.mpesa_callbacks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  checkout_request_id text,
  body jsonb not null,
  outcome text  -- confirmed / already_confirmed / failed / ignored / unknown_payment / not_confirmed_by_query
);
create index mpesa_callbacks_checkout_idx on public.mpesa_callbacks (checkout_request_id);
alter table public.mpesa_callbacks enable row level security;  -- no app access at all
grant all on public.mpesa_callbacks to service_role;
create trigger mpesa_callbacks_append_only before delete on public.mpesa_callbacks
  for each row execute function private.forbid_change();

create index payments_one_pending_idx on public.payments (booking_id) where status in ('initiated', 'pending');

-- Moves a held booking's rooms from "held" to "booked" (same lock order as place_hold).
create function private.convert_hold_to_booked(p_booking_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1
  from public.availability a
  join public.booking_items bi on bi.listing_id = a.listing_id and bi.date = a.date
  where bi.booking_id = p_booking_id
  order by a.listing_id, a.date
  for update of a;

  update public.availability a
  set units_held = a.units_held - n.units, units_booked = a.units_booked + n.units
  from (
    select listing_id, date, sum(units)::int as units
    from public.booking_items where booking_id = p_booking_id group by listing_id, date
  ) n
  where a.listing_id = n.listing_id and a.date = n.date;

  update public.inventory_holds set released_at = now() where booking_id = p_booking_id and released_at is null;

  -- Until providers answer on WhatsApp (Slice 5), auto-accept providers confirm instantly.
  update public.booking_items bi
  set provider_status = case when p.auto_accept then 'auto_accepted'::public.provider_item_status else 'pending'::public.provider_item_status end,
      responded_at = case when p.auto_accept then now() end
  from public.providers p
  where p.id = bi.provider_id and bi.booking_id = p_booking_id;
end $$;

-- Applies a confirmed payment. Returns what happened:
--   confirmed          a held booking is now confirmed (or fully_paid), with its payment plan
--   applied            an instalment payment on a confirmed booking (Slice 3b)
--   refund_due         the hold ended before the money arrived: a refund is recorded
--   already_confirmed  replayed callback: nothing changed
create function public.confirm_payment(p_checkout_request_id text, p_receipt text, p_callback jsonb default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments%rowtype;
  b public.bookings%rowtype;
  s jsonb;
  v_plan_id uuid;
  v_left integer;
  v_pay integer;
  inst record;
begin
  select * into p from public.payments where checkout_request_id = p_checkout_request_id for update;
  if not found then raise exception 'payment_not_found'; end if;

  if p.status = 'succeeded' then
    -- A late callback can supply the receipt for a payment settled by STK Query.
    if p.mpesa_receipt like 'UNKNOWN-%' and p_receipt is not null then
      update public.payments set mpesa_receipt = p_receipt, callback = coalesce(p_callback, callback) where id = p.id;
    end if;
    return 'already_confirmed';
  end if;

  update public.payments
  set status = 'succeeded',
      mpesa_receipt = coalesce(p_receipt, 'UNKNOWN-' || p_checkout_request_id),
      confirmed_at = now(),
      result_code = 0,
      callback = coalesce(p_callback, callback)
  where id = p.id;

  -- Money in: the escrow/aggregator holds it; we owe the traveller a trip.
  insert into public.ledger_entries (txn_id, account, debit_kes, credit_kes, booking_id, ref_type, ref_id, memo)
  select t.txn, x.account, x.debit, x.credit, p.booking_id, 'payment', p.id, coalesce(p_receipt, p_checkout_request_id)
  from (select gen_random_uuid() as txn) t,
       (values ('client_funds', p.amount_kes, 0), ('traveller_prepayments', 0, p.amount_kes)) as x(account, debit, credit);

  select * into b from public.bookings where id = p.booking_id for update;
  update public.bookings set paid_kes = paid_kes + p.amount_kes where id = b.id;

  if b.status = 'held' then
    perform private.convert_hold_to_booked(b.id);
    update public.bookings set status = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = b.id;

    s := p.schedule;
    insert into public.payment_plans (booking_id, deposit_kes, instalment_count, final_due_date, grace_days)
    values (
      b.id,
      (s ->> 'depositKes')::int,
      jsonb_array_length(s -> 'payments') - 1,
      (s ->> 'finalDueDate')::date,
      coalesce((select grace_days from public.packages where id = b.package_id), 2)
    )
    returning id into v_plan_id;

    insert into public.instalments (plan_id, booking_id, seq, amount_kes, paid_kes, due_date, status, paid_at)
    select v_plan_id, b.id, (x ->> 'seq')::int, (x ->> 'amountKes')::int,
           case when (x ->> 'seq')::int = 0 then (x ->> 'amountKes')::int else 0 end,
           (x ->> 'dueDate')::date,
           case when (x ->> 'seq')::int = 0 then 'paid'::public.instalment_status else 'due'::public.instalment_status end,
           case when (x ->> 'seq')::int = 0 then now() end
    from jsonb_array_elements(s -> 'payments') x;

    update public.payments set instalment_id = (select id from public.instalments where plan_id = v_plan_id and seq = 0)
    where id = p.id;

    if b.paid_kes + p.amount_kes >= b.total_kes then
      update public.bookings set status = 'fully_paid', fully_paid_at = now() where id = b.id;
    end if;
    return 'confirmed';
  end if;

  if b.status = 'confirmed' then
    -- An instalment: pay off the oldest unpaid instalments first.
    v_left := p.amount_kes;
    for inst in
      select * from public.instalments where booking_id = b.id and status in ('due', 'overdue') order by seq for update
    loop
      exit when v_left <= 0;
      v_pay := least(v_left, inst.amount_kes - inst.paid_kes);
      update public.instalments
      set paid_kes = paid_kes + v_pay,
          status = case when paid_kes + v_pay = amount_kes then 'paid'::public.instalment_status else status end,
          paid_at = case when paid_kes + v_pay = amount_kes then now() else paid_at end
      where id = inst.id;
      v_left := v_left - v_pay;
    end loop;
    if b.paid_kes + p.amount_kes >= b.total_kes then
      update public.bookings set status = 'fully_paid', fully_paid_at = now() where id = b.id;
    end if;
    return 'applied';
  end if;

  -- The hold ended (or the booking was cancelled) while the traveller was paying.
  insert into public.refunds (booking_id, payment_id, amount_kes, msisdn, status, reason)
  values (b.id, p.id, p.amount_kes, p.msisdn, 'pending', 'Paid after the hold ended: refund the full amount');
  return 'refund_due';
end $$;

-- Records a failed, cancelled or timed-out STK push. Ignores payments already settled.
create function public.fail_payment(
  p_checkout_request_id text, p_status public.payment_status, p_result_code integer, p_result_desc text,
  p_callback jsonb default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments%rowtype;
begin
  select * into p from public.payments where checkout_request_id = p_checkout_request_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p.status not in ('initiated', 'pending') then return 'ignored'; end if;
  update public.payments
  set status = p_status, result_code = p_result_code, result_desc = p_result_desc, callback = coalesce(p_callback, callback)
  where id = p.id;
  return 'failed';
end $$;

-- Holds don't expire under a traveller who is entering their M-PESA PIN right now.
create or replace function public.release_expired_holds() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  released integer := 0;
begin
  for b in
    select bk.id from public.bookings bk
    where bk.status = 'held' and bk.hold_expires_at < now()
      and not exists (
        select 1 from public.payments p
        where p.booking_id = bk.id and p.status in ('initiated', 'pending') and p.created_at > now() - interval '5 minutes'
      )
    order by bk.hold_expires_at
    for update skip locked
  loop
    perform private.release_booking_inventory(b.id);
    update public.bookings set status = 'expired' where id = b.id;
    released := released + 1;
  end loop;
  return released;
end $$;

revoke execute on function public.confirm_payment(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_payment(text, public.payment_status, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function private.convert_hold_to_booked(uuid) from public, anon, authenticated;
revoke execute on function public.release_expired_holds() from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text, jsonb) to service_role;
grant execute on function public.fail_payment(text, public.payment_status, integer, text, jsonb) to service_role;
grant execute on function public.release_expired_holds() to service_role;
