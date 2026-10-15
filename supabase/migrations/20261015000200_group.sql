-- Slice 3c (Group split): friends pay their own shares; the booking confirms when paid
-- shares cover the deposit; the organiser can cover a friend who doesn't pay.

-- A friend the organiser covers ends with a share of what they had paid, possibly 0.
alter table public.group_members drop constraint group_members_share_kes_check;
alter table public.group_members add constraint group_members_share_kes_check check (share_kes >= 0);

-- Group reminders to the organiser go out once per booking, kind and channel.
create unique index notifications_group_once_idx on public.notifications (booking_id, kind, channel)
  where instalment_id is null and kind like 'group_%';

-- Live status for the organiser's screen (RLS still applies: the organiser sees their group).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.group_members;
  end if;
end $$;

-- confirm_payment, now also for group shares (everything else is unchanged from _pay).
create or replace function public.confirm_payment(p_checkout_request_id text, p_receipt text, p_callback jsonb default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments%rowtype;
  b public.bookings%rowtype;
  s jsonb;
  v_plan_id uuid;
  v_left integer;
  v_pay integer;
  v_paid integer;
  inst record;
begin
  select * into p from public.payments where checkout_request_id = p_checkout_request_id for update;
  if not found then raise exception 'payment_not_found'; end if;

  if p.status = 'succeeded' then
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

  insert into public.ledger_entries (txn_id, account, debit_kes, credit_kes, booking_id, ref_type, ref_id, memo)
  select t.txn, x.account, x.debit, x.credit, p.booking_id, 'payment', p.id, coalesce(p_receipt, p_checkout_request_id)
  from (select gen_random_uuid() as txn) t,
       (values ('client_funds', p.amount_kes, 0), ('traveller_prepayments', 0, p.amount_kes)) as x(account, debit, credit);

  select * into b from public.bookings where id = p.booking_id for update;
  update public.bookings set paid_kes = paid_kes + p.amount_kes where id = b.id;
  v_paid := b.paid_kes + p.amount_kes;

  -- A friend's share (group split).
  if p.purpose = 'share' and b.status in ('held', 'confirmed') then
    update public.group_members
    set paid_kes = least(share_kes, paid_kes + p.amount_kes),
        status = case when paid_kes + p.amount_kes >= share_kes then 'paid'::public.member_status else status end
    where id = p.member_id;

    if b.status = 'held' then
      -- Confirmed once paid shares cover the deposit.
      if v_paid < (select deposit_kes from public.payment_plans where booking_id = b.id) then
        return 'applied';
      end if;
      perform private.convert_hold_to_booked(b.id);
      update public.bookings set status = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = b.id;
      if v_paid >= b.total_kes then
        update public.bookings set status = 'fully_paid', fully_paid_at = now() where id = b.id;
      end if;
      return 'confirmed';
    end if;
    if v_paid >= b.total_kes then
      update public.bookings set status = 'fully_paid', fully_paid_at = now() where id = b.id;
    end if;
    return 'applied';
  end if;

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

    if v_paid >= b.total_kes then
      update public.bookings set status = 'fully_paid', fully_paid_at = now() where id = b.id;
    end if;
    return 'confirmed';
  end if;

  if b.status = 'confirmed' then
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
    if v_paid >= b.total_kes then
      update public.bookings set status = 'fully_paid', fully_paid_at = now() where id = b.id;
    end if;
    return 'applied';
  end if;

  insert into public.refunds (booking_id, payment_id, amount_kes, msisdn, status, reason)
  values (b.id, p.id, p.amount_kes, p.msisdn, 'pending', 'Paid after the hold ended: refund the full amount');
  return 'refund_due';
end $$;

-- The organiser takes over what a friend hasn't paid. The friend keeps what they paid
-- (status paid if they paid anything, removed if nothing). Shares still add up to the total.
create function public.cover_share(p_member_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  m public.group_members%rowtype;
  v_left integer;
begin
  select * into m from public.group_members where id = p_member_id for update;
  if not found or m.is_organiser then raise exception 'member_not_found'; end if;
  perform 1 from public.bookings where id = m.booking_id and status in ('held', 'confirmed') for update;
  if not found then raise exception 'not_coverable'; end if;
  if exists (select 1 from public.payments where member_id = m.id and status in ('initiated', 'pending')) then
    raise exception 'payment_in_progress';
  end if;
  v_left := m.share_kes - m.paid_kes;
  if v_left <= 0 then return 0; end if;
  update public.group_members
  set share_kes = paid_kes, status = case when paid_kes > 0 then 'paid'::public.member_status else 'removed'::public.member_status end
  where id = m.id;
  update public.group_members set share_kes = share_kes + v_left,
    status = case when status = 'paid' then 'invited'::public.member_status else status end
  where booking_id = m.booking_id and is_organiser;
  return v_left;
end $$;

revoke execute on function public.confirm_payment(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.cover_share(uuid) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text, jsonb) to service_role;
grant execute on function public.cover_share(uuid) to service_role;
