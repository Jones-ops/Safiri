-- Money: payment plans, instalments, Ratiba mandates, M-Pesa payments, group shares,
-- the double-entry ledger, payouts and refunds. Every amount is integer KES.

create table public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  deposit_kes integer not null check (deposit_kes > 0),
  instalment_count integer not null check (instalment_count >= 0),
  final_due_date date not null,
  grace_days integer not null default 2 check (grace_days >= 0),
  autopay boolean not null default false  -- true when a Ratiba mandate is active
);

-- seq 0 is the deposit; 1..n are the instalments.
create table public.instalments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  plan_id uuid not null references public.payment_plans (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  seq integer not null check (seq >= 0),
  amount_kes integer not null check (amount_kes > 0),
  paid_kes integer not null default 0,
  due_date date not null,
  status public.instalment_status not null default 'due',
  paid_at timestamptz,
  unique (plan_id, seq),
  check (paid_kes between 0 and amount_kes)
);
create index instalments_due_idx on public.instalments (due_date) where status in ('due', 'overdue');
create index instalments_booking_idx on public.instalments (booking_id);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  name text,
  phone public.msisdn not null,
  share_kes integer not null check (share_kes > 0),
  paid_kes integer not null default 0,
  invite_code text not null unique check (invite_code ~ '^[A-Za-z0-9]{8,16}$'),
  is_organiser boolean not null default false,
  status public.member_status not null default 'invited',
  unique (booking_id, phone),
  check (paid_kes between 0 and share_kes)
);
create index group_members_user_idx on public.group_members (user_id);

-- M-PESA Ratiba standing orders, authorised once at checkout.
create table public.mandates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  msisdn public.msisdn not null,
  ratiba_ref text unique,
  amount_kes integer not null check (amount_kes > 0),
  frequency text not null default 'monthly' check (frequency in ('weekly', 'fortnightly', 'monthly')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status public.mandate_status not null default 'pending'
);
create index mandates_booking_idx on public.mandates (booking_id);

-- The unique Daraja IDs make callbacks idempotent: replaying a callback can't create a
-- second payment. A payment only becomes 'succeeded' after STK Query confirms it.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booking_id uuid not null references public.bookings (id),
  member_id uuid references public.group_members (id),
  instalment_id uuid references public.instalments (id),
  msisdn public.msisdn not null,
  amount_kes integer not null check (amount_kes between 1 and 250000),  -- M-Pesa single-payment limit
  merchant_request_id text unique,
  checkout_request_id text unique,
  mpesa_receipt text unique,
  status public.payment_status not null default 'initiated',
  result_code integer,
  result_desc text,
  callback jsonb,  -- raw Daraja callback, kept for reconciliation; never shown to app users
  query_attempts integer not null default 0,
  confirmed_at timestamptz,
  check (status <> 'succeeded' or (mpesa_receipt is not null and confirmed_at is not null))
);
create index payments_booking_idx on public.payments (booking_id);
create index payments_pending_idx on public.payments (created_at) where status in ('initiated', 'pending');

-- Chart of accounts for the double-entry ledger.
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('asset', 'liability', 'income', 'expense'))
);

insert into public.ledger_accounts (code, name, kind) values
  ('client_funds',          'Client money held by the escrow / aggregator partner', 'asset'),
  ('traveller_prepayments', 'Paid by travellers for trips not yet taken',          'liability'),
  ('provider_payable',      'Owed to providers (lodges, guides, drivers)',          'liability'),
  ('agency_payable',        'Owed to agencies (their margin)',                      'liability'),
  ('refunds_payable',       'Refunds approved but not yet sent',                    'liability'),
  ('platform_revenue',      'Safiri platform fee',                                  'income'),
  ('mpesa_charges',         'M-Pesa transaction charges',                           'expense');

-- Each money movement is one txn_id with two or more lines. Exactly one side of each line
-- is positive, and a transaction's debits must equal its credits when it commits.
-- Balances are derived (sum debits - credits); entries are never edited or deleted.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  txn_id uuid not null,
  account text not null references public.ledger_accounts (code),
  debit_kes integer not null default 0 check (debit_kes >= 0),
  credit_kes integer not null default 0 check (credit_kes >= 0),
  booking_id uuid references public.bookings (id),
  ref_type text not null,  -- payment / refund / payout / recognise / adjustment
  ref_id uuid,
  memo text,
  check ((debit_kes > 0) <> (credit_kes > 0))
);
create index ledger_entries_txn_idx on public.ledger_entries (txn_id);
create index ledger_entries_account_idx on public.ledger_entries (account, created_at);
create index ledger_entries_booking_idx on public.ledger_entries (booking_id);

create function private.check_txn_balanced() returns trigger
language plpgsql as $$
declare
  diff bigint;
begin
  select coalesce(sum(debit_kes), 0) - coalesce(sum(credit_kes), 0) into diff
  from public.ledger_entries where txn_id = new.txn_id;
  if diff <> 0 then
    raise exception 'ledger transaction % does not balance (debits - credits = %)', new.txn_id, diff
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

-- Deferred, so all lines of a transaction are inserted before the check runs at commit.
create constraint trigger ledger_txn_balanced
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function private.check_txn_balanced();

create trigger ledger_entries_append_only
  before update or delete on public.ledger_entries
  for each row execute function private.forbid_change();

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider_id uuid references public.providers (id),
  agency_id uuid references public.agencies (id),
  amount_kes integer not null check (amount_kes > 0),
  method public.money_method not null default 'mpesa_b2c',
  msisdn public.msisdn,
  status public.payout_status not null default 'scheduled',
  conversation_id text unique,  -- Daraja B2C ConversationID, for idempotent results
  period_start date,
  period_end date,
  paid_at timestamptz,
  failure_reason text,
  check (num_nonnulls(provider_id, agency_id) = 1)
);
create index payouts_provider_idx on public.payouts (provider_id);
create index payouts_agency_idx on public.payouts (agency_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booking_id uuid not null references public.bookings (id),
  payment_id uuid references public.payments (id),
  amount_kes integer not null check (amount_kes > 0),
  method public.money_method not null default 'mpesa_b2c',
  msisdn public.msisdn,
  status public.refund_status not null default 'pending',
  reason text,
  conversation_id text unique,
  paid_at timestamptz
);
create index refunds_booking_idx on public.refunds (booking_id);
