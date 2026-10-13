-- Row Level Security, grants, and shared triggers.
--
-- Model: the app uses the anon key + a user JWT and can only READ what these policies allow,
-- plus a few self-service writes (own profile, consents, reviews, media). Everything that
-- touches money or inventory goes through the Node API with the service role, which bypasses RLS.
-- Column grants hide private columns (payout numbers, agency margins, provider nets, raw callbacks).

-- 1. Turn RLS on for every table, remove default access, give the service role full access.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon, authenticated', t.tablename);
    execute format('grant all on public.%I to service_role', t.tablename);
  end loop;
end $$;

-- 2. updated_at on every table that has it.
do $$
declare t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join pg_tables p on p.schemaname = c.table_schema and p.tablename = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at'
      and c.table_name not in ('audit_log', 'ledger_entries')  -- append-only
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      t.table_name);
  end loop;
end $$;

-- 3. Audit log on tables where who-changed-what matters.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'consents', 'providers', 'agencies', 'agency_providers', 'packages',
                           'listing_prices', 'bookings', 'booking_items', 'payment_plans', 'instalments',
                           'mandates', 'payments', 'group_members', 'payouts', 'refunds', 'reviews', 'referrals']
  loop
    execute format(
      'create trigger audit after insert or update or delete on public.%I for each row execute function private.audit()', t);
  end loop;
end $$;

-- 4. Helper checks. SECURITY DEFINER so policies can look across tables without recursion.
create function private.owns_booking(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings where id = b and user_id = auth.uid());
$$;

create function private.is_booking_member(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members
    where booking_id = b and user_id = auth.uid() and status <> 'removed');
$$;

create function private.owns_member(m uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where id = m and user_id = auth.uid());
$$;

create function private.owns_provider(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.providers where id = p and owner_id = auth.uid());
$$;

create function private.owns_agency(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agencies where id = a and owner_id = auth.uid());
$$;

create function private.owns_listing(l uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listings li join public.providers p on p.id = li.provider_id
    where li.id = l and p.owner_id = auth.uid());
$$;

-- A listing is public when it is active and its provider is verified.
create function private.listing_is_public(l uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listings li join public.providers p on p.id = li.provider_id
    where li.id = l and li.active and p.verified_at is not null);
$$;

create function private.provider_is_verified(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.providers where id = p and verified_at is not null);
$$;

create function private.agency_linked_to_listing(l uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listings li
    join public.agency_providers ap on ap.provider_id = li.provider_id and ap.status = 'active'
    join public.agencies a on a.id = ap.agency_id
    where li.id = l and a.owner_id = auth.uid());
$$;

create function private.package_is_public(pk uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.packages where id = pk and status = 'published');
$$;

create function private.owns_package(pk uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.packages p join public.agencies a on a.id = p.agency_id
    where p.id = pk and a.owner_id = auth.uid());
$$;

create function private.provider_on_booking(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.booking_items bi join public.providers p on p.id = bi.provider_id
    where bi.booking_id = b and p.owner_id = auth.uid());
$$;

create function private.owns_trip(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips where id = t and organiser_id = auth.uid());
$$;

create function private.review_is_public(r uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reviews where id = r and status = 'published');
$$;

-- 5. Identity ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (name, language, low_data) on public.profiles to authenticated;  -- never roles or phone
create policy "own profile: read" on public.profiles for select to authenticated
  using (user_id = auth.uid());
create policy "own profile: update" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert on public.consents to authenticated;
grant update (granted_at, withdrawn_at, notice_version) on public.consents to authenticated;
create policy "own consents: read" on public.consents for select to authenticated
  using (user_id = auth.uid());
create policy "own consents: add" on public.consents for insert to authenticated
  with check (user_id = auth.uid());
create policy "own consents: change" on public.consents for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 6. Supply (public catalogue) ----------------------------------------------------------
grant select on public.destinations to anon, authenticated;
create policy "destinations are public" on public.destinations for select to anon, authenticated
  using (true);

grant select (id, created_at, updated_at, type, name, destination_id, licence_no, verified_at, lat, lng)
  on public.providers to anon, authenticated;
create policy "verified providers are public; owners see their own" on public.providers
  for select to anon, authenticated
  using (verified_at is not null or owner_id = auth.uid());

grant select (id, created_at, updated_at, name, slug, licence_no, verified_at) on public.agencies to anon, authenticated;
create policy "verified agencies are public; owners see their own" on public.agencies
  for select to anon, authenticated
  using (verified_at is not null or owner_id = auth.uid());

grant select on public.agency_providers to authenticated;
create policy "agency and provider see their links" on public.agency_providers for select to authenticated
  using (private.owns_agency(agency_id) or private.owns_provider(provider_id));

grant select on public.listings to anon, authenticated;
create policy "bookable listings are public; owners see their own" on public.listings
  for select to anon, authenticated
  using ((active and private.provider_is_verified(provider_id)) or private.owns_provider(provider_id));

-- Net prices are business data: only the provider and its linked agencies see them.
grant select on public.listing_prices to authenticated;
create policy "provider and linked agencies see net prices" on public.listing_prices
  for select to authenticated
  using (private.owns_listing(listing_id) or private.agency_linked_to_listing(listing_id));

grant select on public.availability to anon, authenticated;
create policy "availability of public listings" on public.availability for select to anon, authenticated
  using (private.listing_is_public(listing_id) or private.owns_listing(listing_id));

-- 7. Products ---------------------------------------------------------------------------
grant select (id, created_at, updated_at, agency_id, destination_id, slug, title, summary, nights,
              deposit_pct, instalments, final_due_days, grace_days, cancel_policy, inclusions,
              exclusions, hero_image, sw, from_price_kes, status, published_at)
  on public.packages to anon, authenticated;  -- margin_bps stays private to the agency (via API)
create policy "published packages are public; agencies see their own" on public.packages
  for select to anon, authenticated
  using (status = 'published' or private.owns_agency(agency_id));

grant select on public.package_items to anon, authenticated;
create policy "items of visible packages" on public.package_items for select to anon, authenticated
  using (private.package_is_public(package_id) or private.owns_package(package_id));

-- 8. Bookings (read-only for app users; the API writes) ----------------------------------
grant select on public.quotes to authenticated;
create policy "own quotes" on public.quotes for select to authenticated
  using (user_id = auth.uid());

grant select on public.trips to authenticated;
create policy "own trips" on public.trips for select to authenticated
  using (organiser_id = auth.uid());

grant select on public.trip_items to authenticated;
create policy "items of own trips" on public.trip_items for select to authenticated
  using (private.owns_trip(trip_id));

grant select on public.bookings to authenticated;
create policy "travellers, group members, providers and agencies see their bookings" on public.bookings
  for select to authenticated
  using (
    user_id = auth.uid()
    or private.is_booking_member(id)
    or private.provider_on_booking(id)
    or (package_id is not null and private.owns_package(package_id))
  );

-- Travellers don't see provider nets per line (that would reveal margins).
grant select (id, created_at, updated_at, booking_id, listing_id, provider_id, date, units,
              provider_status, responded_at)
  on public.booking_items to authenticated;
create policy "booking items for the people on the booking" on public.booking_items
  for select to authenticated
  using (
    private.owns_booking(booking_id)
    or private.is_booking_member(booking_id)
    or private.owns_provider(provider_id)
  );

-- 9. Money ------------------------------------------------------------------------------
grant select on public.payment_plans to authenticated;
create policy "plans of own bookings" on public.payment_plans for select to authenticated
  using (private.owns_booking(booking_id) or private.is_booking_member(booking_id));

grant select on public.instalments to authenticated;
create policy "instalments of own bookings" on public.instalments for select to authenticated
  using (private.owns_booking(booking_id) or private.is_booking_member(booking_id));

grant select on public.mandates to authenticated;
create policy "mandates of own bookings" on public.mandates for select to authenticated
  using (private.owns_booking(booking_id));

grant select (id, created_at, updated_at, booking_id, member_id, instalment_id, msisdn, amount_kes,
              mpesa_receipt, status, result_desc, confirmed_at)
  on public.payments to authenticated;
create policy "payments on own bookings, or own share" on public.payments for select to authenticated
  using (private.owns_booking(booking_id) or (member_id is not null and private.owns_member(member_id)));

grant select on public.group_members to authenticated;
create policy "organiser sees the group; members see themselves" on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or private.owns_booking(booking_id));

grant select on public.payouts to authenticated;
create policy "providers and agencies see their payouts" on public.payouts for select to authenticated
  using (
    (provider_id is not null and private.owns_provider(provider_id))
    or (agency_id is not null and private.owns_agency(agency_id))
  );

grant select on public.refunds to authenticated;
create policy "refunds of own bookings" on public.refunds for select to authenticated
  using (private.owns_booking(booking_id));

-- ledger_accounts, ledger_entries, inventory_holds and audit_log: no app access at all.

-- 10. Engagement ------------------------------------------------------------------------
grant select on public.reviews to anon, authenticated;
grant insert (booking_id, rating, body) on public.reviews to authenticated;
create policy "published reviews are public; authors see their own" on public.reviews
  for select to anon, authenticated
  using (status = 'published' or user_id = auth.uid());
create policy "travellers review their own completed bookings" on public.reviews
  for insert to authenticated
  with check (user_id = auth.uid());  -- completion is checked by the reviews_only_completed trigger

grant select on public.media to anon, authenticated;
grant insert (review_id, bucket, path, kind, bytes) on public.media to authenticated;
grant update (upload_status, bytes) on public.media to authenticated;
create policy "own media, and media on published reviews" on public.media for select to anon, authenticated
  using (owner_id = auth.uid() or (review_id is not null and private.review_is_public(review_id)));
create policy "add own media" on public.media for insert to authenticated
  with check (owner_id = auth.uid());
create policy "update own media" on public.media for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select on public.referrals to authenticated;
create policy "own referral codes" on public.referrals for select to authenticated
  using (owner_id = auth.uid());

grant select on public.referral_redemptions to authenticated;
create policy "own redemptions" on public.referral_redemptions for select to authenticated
  using (user_id = auth.uid());

grant select (id, created_at, updated_at, user_id, booking_id, channel, template, status, sent_at)
  on public.notifications to authenticated;
create policy "own notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());
