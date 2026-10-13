-- Supply: destinations, providers, agencies, listings, prices and availability.

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  region text not null,
  lat numeric(8, 5) not null,
  lng numeric(8, 5) not null,
  summary text not null default '',
  best_time text not null default '',
  getting_there text not null default '',  -- how to get there from Nairobi
  faq jsonb not null default '[]' check (jsonb_typeof(faq) = 'array'),  -- [{ "q": "...", "a": "..." }]
  hero_image text,                          -- asset key, e.g. "naivasha-lake"
  sw jsonb not null default '{}'            -- Kiswahili versions of the text columns
);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  type public.provider_type not null,
  name text not null,
  destination_id uuid references public.destinations (id),
  licence_no text,
  verified_at timestamptz,                 -- only verified providers are bookable
  verified_by uuid references auth.users (id),
  payout_msisdn public.msisdn,             -- private: never exposed to app users (see column grants)
  whatsapp_msisdn public.msisdn,
  lat numeric(8, 5),
  lng numeric(8, 5),
  auto_accept boolean not null default true  -- until Slice 5, seeded providers auto-accept bookings
);
create index providers_owner_idx on public.providers (owner_id);
create index providers_destination_idx on public.providers (destination_id);

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  licence_no text,
  verified_at timestamptz
);
create index agencies_owner_idx on public.agencies (owner_id);

-- An agency can only package providers it is linked to.
create table public.agency_providers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  status public.link_status not null default 'pending',
  unique (agency_id, provider_id)
);
create index agency_providers_provider_idx on public.agency_providers (provider_id);

-- capacity = rooms for a stay, seats for transport, places for an activity (per day).
-- Stay prices are per person per night, twin share.
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  destination_id uuid not null references public.destinations (id),
  kind public.listing_kind not null,
  unit public.listing_unit not null,
  title text not null,
  description text not null default '',
  capacity integer not null check (capacity > 0),
  active boolean not null default true,
  sw jsonb not null default '{}'
);
create index listings_provider_idx on public.listings (provider_id);
create index listings_destination_idx on public.listings (destination_id) where active;

-- Net = what the provider receives, per unit. The season covering the travel date applies.
create table public.listing_prices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  season_start date not null,
  season_end date not null,
  net_kes integer not null check (net_kes > 0),
  check (season_end >= season_start)
);
create index listing_prices_lookup_idx on public.listing_prices (listing_id, season_start, season_end);

-- One row per listing per date. The CHECK makes overselling impossible: the API locks the
-- rows (SELECT ... FOR UPDATE, in date order) and increments units_held inside one transaction.
create table public.availability (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  date date not null,
  units_total integer not null check (units_total >= 0),
  units_held integer not null default 0 check (units_held >= 0),
  units_booked integer not null default 0 check (units_booked >= 0),
  unique (listing_id, date),
  constraint availability_not_oversold check (units_held + units_booked <= units_total)
);
