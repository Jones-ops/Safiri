-- Slice 1 (Discover): public catalogue tweaks and the public photo bucket.

-- Public reviews show rating, text and date only: not which booking they came from.
revoke select on public.reviews from anon, authenticated;
grant select (id, created_at, updated_at, user_id, package_id, rating, body, status)
  on public.reviews to anon, authenticated;

-- Public photos (destinations, packages) in Supabase Storage, in 640 and 1280 widths.
-- Uploaded by `npm run photos:upload --workspace @safiri/api`. Skipped where Storage
-- isn't installed (the PGlite test database).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('public-images', 'public-images', true, 2097152, array['image/jpeg', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- Explore filters by price and destination.
create index packages_price_idx on public.packages (from_price_kes) where status = 'published';
