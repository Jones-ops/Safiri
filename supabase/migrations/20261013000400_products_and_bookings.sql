-- Products (packages) and bookings: quotes, holds, trips, bookings and their items.

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  agency_id uuid not null references public.agencies (id),
  destination_id uuid not null references public.destinations (id),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  summary text not null default '',
  nights integer not null check (nights >= 0),
  margin_bps integer not null default 1500 check (margin_bps between 0 and 10000),  -- private to the agency
  deposit_pct integer not null default 25 check (deposit_pct between 1 and 100),
  instalments integer not null default 3 check (instalments between 0 and 12),
  final_due_days integer not null default 7 check (final_due_days >= 0),
  grace_days integer not null default 2 check (grace_days >= 0),
  -- Tiers, most generous first: cancel at least days_before days ahead to get refund_pct back.
  cancel_policy jsonb not null default
    '[{"days_before":30,"refund_pct":100},{"days_before":14,"refund_pct":50},{"days_before":0,"refund_pct":0}]',
  inclusions text[] not null default '{}',
  exclusions text[] not null default '{}',
  hero_image text,
  sw jsonb not null default '{}',
  -- Display price per person, written by the API from current prices. Never charged:
  -- every booking is charged from a fresh server quote.
  from_price_kes integer check (from_price_kes > 0),
  status public.publish_status not null default 'draft',
  published_at timestamptz
);
create index packages_destination_idx on public.packages (destination_id) where status = 'published';
create index packages_agency_idx on public.packages (agency_id);

create table public.package_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  package_id uuid not null references public.packages (id) on delete cascade,
  listing_id uuid not null references public.listings (id),
  day integer not null check (day >= 1),
  qty integer not null default 1 check (qty > 0),  -- per person: nights for a stay, 1 for most others
  note text
);
create index package_items_package_idx on public.package_items (package_id, day);

-- Server-made prices. The client never sets a price; it shows the quote it was given.
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  package_id uuid references public.packages (id),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  travellers integer not null check (travellers between 1 and 20),
  items jsonb not null,
  breakdown jsonb not null,
  per_person_kes integer not null check (per_person_kes > 0),
  total_kes integer not null check (total_kes > 0),
  expires_at timestamptz not null default now() + interval '15 minutes'
);
create index quotes_user_idx on public.quotes (user_id);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  organiser_id uuid references auth.users (id) on delete set null,
  destination_id uuid references public.destinations (id),
  title text,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  travellers integer not null check (travellers between 1 and 20)
);
create index trips_organiser_idx on public.trips (organiser_id);

create table public.trip_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  listing_id uuid not null references public.listings (id),
  date date not null,
  units integer not null check (units > 0),
  day integer check (day >= 1)
);
create index trip_items_trip_idx on public.trip_items (trip_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ref text not null unique check (ref ~ '^SAF-[A-Z0-9]{6}$'),
  user_id uuid references auth.users (id) on delete set null,  -- null for a guest until they sign in
  phone public.msisdn not null,
  package_id uuid references public.packages (id),
  trip_id uuid references public.trips (id),
  quote_id uuid references public.quotes (id),
  status public.booking_status not null default 'draft',
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  travellers integer not null check (travellers between 1 and 20),
  total_kes integer not null check (total_kes > 0),
  paid_kes integer not null default 0 check (paid_kes >= 0),
  is_group boolean not null default false,
  hold_expires_at timestamptz,
  confirmed_at timestamptz,
  fully_paid_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  check (package_id is not null or trip_id is not null),
  constraint bookings_paid_within_total check (paid_kes <= total_kes)
);
create index bookings_user_idx on public.bookings (user_id);
create index bookings_phone_idx on public.bookings (phone);
create index bookings_package_idx on public.bookings (package_id);
create index bookings_hold_expiry_idx on public.bookings (hold_expires_at) where status = 'held';

-- Locks inventory for 15 minutes. last_date is inclusive (the last night or day used).
create table public.inventory_holds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  listing_id uuid not null references public.listings (id),
  booking_id uuid references public.bookings (id) on delete cascade,
  quote_id uuid references public.quotes (id),
  first_date date not null,
  last_date date not null check (last_date >= first_date),
  units integer not null check (units > 0),
  expires_at timestamptz not null default now() + interval '15 minutes',
  released_at timestamptz
);
create index inventory_holds_open_idx on public.inventory_holds (expires_at) where released_at is null;
create index inventory_holds_booking_idx on public.inventory_holds (booking_id);

-- One row per listing per date. Providers accept or decline per item.
create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  listing_id uuid not null references public.listings (id),
  provider_id uuid not null references public.providers (id),
  date date not null,
  units integer not null check (units > 0),
  net_kes integer not null check (net_kes >= 0),  -- what this provider receives for the line
  provider_status public.provider_item_status not null default 'pending',
  responded_at timestamptz
);
create index booking_items_booking_idx on public.booking_items (booking_id);
create index booking_items_provider_idx on public.booking_items (provider_id, date);

-- The database refuses state changes the product rules don't allow (mirrors packages/shared).
create function private.check_booking_transition() returns trigger
language plpgsql as $$
declare
  allowed text[] := case old.status
    when 'draft' then array['held', 'cancelled']
    when 'held' then array['confirmed', 'expired', 'cancelled']
    when 'confirmed' then array['fully_paid', 'cancelled']
    when 'fully_paid' then array['completed', 'cancelled']
    else array[]::text[]
  end;
begin
  if new.status is distinct from old.status and not (new.status::text = any (allowed)) then
    raise exception 'booking % cannot move from % to %', old.ref, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger bookings_status_transition
  before update of status on public.bookings
  for each row execute function private.check_booking_transition();
