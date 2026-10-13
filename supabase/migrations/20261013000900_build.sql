-- Slice 2 (Build): trip builder quotes and 15-minute inventory holds.
--
-- Holds are placed by ONE database function so that checking and taking inventory happen in
-- a single transaction: it locks the availability rows (in listing, date order, so two holds
-- can never deadlock), checks there is room, and takes it. Twenty simultaneous requests for
-- the last room therefore produce exactly one hold. The availability CHECK constraint is the
-- second line of defence. Only the API (service role) can call these functions.

alter table public.quotes add column destination_id uuid references public.destinations (id);
alter table public.destinations add column drive_hours numeric(3, 1) check (drive_hours > 0);  -- from Nairobi, one way

update public.destinations set drive_hours = case slug
  when 'naivasha' then 2 when 'maasai-mara' then 5.5 when 'diani' then 6.5 when 'amboseli' then 4 end;

-- A traveller (by phone) can hold at most this many trips at once, so nobody can squat inventory.
create function private.max_active_holds() returns integer language sql immutable as $$ select 3 $$;

create function private.new_booking_ref() returns text
language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I: easy to read out on the phone
  candidate text;
begin
  loop
    candidate := 'SAF-' || (
      select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
      from generate_series(1, 6));
    exit when not exists (select 1 from public.bookings where ref = candidate);
  end loop;
  return candidate;
end $$;

-- Gives back the inventory a held booking took. Locks rows in the same order as place_hold.
create function private.release_booking_inventory(p_booking_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1
  from public.availability a
  join public.booking_items bi on bi.listing_id = a.listing_id and bi.date = a.date
  where bi.booking_id = p_booking_id
  order by a.listing_id, a.date
  for update of a;

  update public.availability a
  set units_held = a.units_held - n.units
  from (
    select listing_id, date, sum(units)::int as units
    from public.booking_items where booking_id = p_booking_id
    group by listing_id, date
  ) n
  where a.listing_id = n.listing_id and a.date = n.date;

  update public.inventory_holds set released_at = now()
  where booking_id = p_booking_id and released_at is null;
end $$;

-- Expires every hold past its 15 minutes. Run every minute by the API's job queue, and at the
-- start of every new hold, so a stale hold never blocks a real traveller.
create function public.release_expired_holds() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  released integer := 0;
begin
  for b in
    select id from public.bookings
    where status = 'held' and hold_expires_at < now()
    order by hold_expires_at
    for update skip locked  -- another worker may be releasing the same holds
  loop
    perform private.release_booking_inventory(b.id);
    update public.bookings set status = 'expired' where id = b.id;
    released := released + 1;
  end loop;
  return released;
end $$;

-- Takes inventory for a server-made quote and creates a 'held' booking for 15 minutes.
-- Errors (SQLSTATE P0001, message = code): quote_not_found, quote_expired, quote_used,
-- too_many_holds, sold_out. The API turns these into HTTP responses.
create function public.place_hold(p_quote_id uuid, p_phone public.msisdn, p_user_id uuid default null)
returns table (booking_id uuid, ref text, hold_expires_at timestamptz, total_kes integer)
language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes%rowtype;
  v_booking_id uuid;
  v_trip_id uuid;
  v_ref text;
  v_expires timestamptz := now() + interval '15 minutes';
  v_short integer;
begin
  perform public.release_expired_holds();

  select * into q from public.quotes where id = p_quote_id;
  if not found then raise exception 'quote_not_found'; end if;
  if q.expires_at < now() then raise exception 'quote_expired'; end if;
  if jsonb_typeof(q.items) <> 'array' or jsonb_array_length(q.items) = 0 then raise exception 'quote_not_found'; end if;

  if (select count(*) from public.bookings
      where phone = p_phone and status = 'held') >= private.max_active_holds() then
    raise exception 'too_many_holds';
  end if;

  -- Lock every availability row this trip needs, always in the same order.
  perform 1
  from public.availability a
  join (
    select (i ->> 'listing_id')::uuid as listing_id, (i ->> 'date')::date as date
    from jsonb_array_elements(q.items) i
  ) need on need.listing_id = a.listing_id and need.date = a.date
  order by a.listing_id, a.date
  for update of a;

  -- One hold per quote (checked after locking, so two requests with the same quote can't both pass).
  if exists (select 1 from public.bookings b where b.quote_id = p_quote_id and b.status <> 'expired' and b.status <> 'cancelled') then
    raise exception 'quote_used';
  end if;

  select count(*) into v_short
  from (
    select (i ->> 'listing_id')::uuid as listing_id, (i ->> 'date')::date as date, sum((i ->> 'units')::int) as units
    from jsonb_array_elements(q.items) i
    group by 1, 2
  ) need
  left join public.availability a on a.listing_id = need.listing_id and a.date = need.date
  where a.id is null or a.units_total - a.units_held - a.units_booked < need.units;
  if v_short > 0 then raise exception 'sold_out'; end if;

  update public.availability a
  set units_held = a.units_held + need.units
  from (
    select (i ->> 'listing_id')::uuid as listing_id, (i ->> 'date')::date as date, sum((i ->> 'units')::int)::int as units
    from jsonb_array_elements(q.items) i
    group by 1, 2
  ) need
  where a.listing_id = need.listing_id and a.date = need.date;

  -- Custom trips from the builder are recorded as a trip; packages point at the package.
  if q.package_id is null then
    insert into public.trips (organiser_id, destination_id, start_date, end_date, travellers)
    values (p_user_id, q.destination_id, q.start_date, q.end_date, q.travellers)
    returning id into v_trip_id;
    insert into public.trip_items (trip_id, listing_id, date, units)
    select v_trip_id, (i ->> 'listing_id')::uuid, (i ->> 'date')::date, (i ->> 'units')::int
    from jsonb_array_elements(q.items) i;
  end if;

  v_ref := private.new_booking_ref();
  insert into public.bookings (ref, user_id, phone, package_id, trip_id, quote_id, status, start_date, end_date,
                               travellers, total_kes, hold_expires_at)
  values (v_ref, p_user_id, p_phone, q.package_id, v_trip_id, q.id, 'held', q.start_date, q.end_date,
          q.travellers, q.total_kes, v_expires)
  returning id into v_booking_id;

  insert into public.booking_items (booking_id, listing_id, provider_id, date, units, net_kes)
  select v_booking_id, (i ->> 'listing_id')::uuid, (i ->> 'provider_id')::uuid, (i ->> 'date')::date,
         (i ->> 'units')::int, (i ->> 'net_kes')::int
  from jsonb_array_elements(q.items) i;

  insert into public.inventory_holds (listing_id, booking_id, quote_id, first_date, last_date, units, expires_at)
  select (i ->> 'listing_id')::uuid, v_booking_id, q.id, min((i ->> 'date')::date), max((i ->> 'date')::date),
         max((i ->> 'units')::int), v_expires
  from jsonb_array_elements(q.items) i
  group by 1;

  -- A signed-in traveller can see their own quote (RLS: user_id = auth.uid()).
  if p_user_id is not null and q.user_id is null then
    update public.quotes set user_id = p_user_id where id = q.id;
  end if;

  return query select v_booking_id, v_ref, v_expires, q.total_kes;
end $$;

-- Lets a traveller give a hold back before it expires (e.g. they changed their mind).
create function public.cancel_hold(p_booking_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.bookings where id = p_booking_id and status = 'held' for update;
  if not found then return false; end if;
  perform private.release_booking_inventory(p_booking_id);
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Hold released by traveller'
  where id = p_booking_id;
  return true;
end $$;

-- Functions are executable by everyone by default: lock these to the API.
revoke execute on function public.place_hold(uuid, public.msisdn, uuid) from public, anon, authenticated;
revoke execute on function public.release_expired_holds() from public, anon, authenticated;
revoke execute on function public.cancel_hold(uuid) from public, anon, authenticated;
revoke execute on function private.release_booking_inventory(uuid) from public, anon, authenticated;
revoke execute on function private.new_booking_ref() from public, anon, authenticated;
grant execute on function public.place_hold(uuid, public.msisdn, uuid) to service_role;
grant execute on function public.release_expired_holds() to service_role;
grant execute on function public.cancel_hold(uuid) to service_role;

-- Public destinations show drive time (builder warning); the column is covered by the
-- existing table-level select grant.
