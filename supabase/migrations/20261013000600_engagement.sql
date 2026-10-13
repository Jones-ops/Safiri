-- Engagement: reviews, media uploads, referrals and outbound notifications.

-- Reviews only from completed bookings (enforced by trigger below), one per booking.
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booking_id uuid not null unique references public.bookings (id),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  package_id uuid references public.packages (id),
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(body) <= 2000),
  status public.review_status not null default 'published'
);
create index reviews_package_idx on public.reviews (package_id) where status = 'published';

create function private.check_review_allowed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = new.booking_id;
  if not found or b.status <> 'completed' then
    raise exception 'only a completed booking can be reviewed' using errcode = 'check_violation';
  end if;
  if b.user_id is distinct from new.user_id and not exists (
    select 1 from public.group_members m
    where m.booking_id = b.id and m.user_id = new.user_id and m.status = 'paid'
  ) then
    raise exception 'only a traveller on this booking can review it' using errcode = 'check_violation';
  end if;
  new.package_id := b.package_id;
  return new;
end $$;

create trigger reviews_only_completed
  before insert on public.reviews
  for each row execute function private.check_review_allowed();

-- Photos and clips. Uploads are resumable (Supabase Storage TUS); upload_status tracks progress.
create table public.media (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  review_id uuid references public.reviews (id) on delete set null,
  bucket text not null default 'media',
  path text not null,
  kind public.media_kind not null,
  bytes bigint check (bytes >= 0),
  upload_status public.upload_status not null default 'pending',
  unique (bucket, path)
);
create index media_owner_idx on public.media (owner_id);
create index media_review_idx on public.media (review_id);

-- A referral code gives both sides a capped, expiring discount on a future booking.
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{6,10}$'),
  discount_kes integer not null check (discount_kes between 1 and 5000),
  max_uses integer not null default 10 check (max_uses > 0),
  expires_at timestamptz not null
);
create index referrals_owner_idx on public.referrals (owner_id);

-- unique (user_id): a new traveller can use a referral discount once, ever.
create table public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  referral_id uuid not null references public.referrals (id),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  booking_id uuid references public.bookings (id),
  discount_kes integer not null check (discount_kes > 0)
);
create index referral_redemptions_referral_idx on public.referral_redemptions (referral_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  phone public.msisdn,
  booking_id uuid references public.bookings (id) on delete cascade,
  channel public.notification_channel not null,
  template text not null,  -- e.g. payment_reminder (WhatsApp template name)
  payload jsonb not null default '{}',
  status public.notification_status not null default 'queued',
  provider_message_id text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_queue_idx on public.notifications (scheduled_for) where status = 'queued';
