-- Slice 6 (Come back) and the account rights under the Data Protection Act.

-- A referral: the new traveller's discount is recorded once (unique user_id, from the
-- _engagement migration); the referrer's reward (a one-use code) is noted here.
alter table public.referral_redemptions add column rewarded_at timestamptz, add column reward_referral_id uuid references public.referrals (id);
alter table public.quotes add column referral_id uuid references public.referrals (id), add column discount_kes integer not null default 0 check (discount_kes >= 0);
alter table public.bookings add column discount_kes integer not null default 0 check (discount_kes >= 0);

-- Account deletion keeps what the law requires (booking and payment records, 7 years) and
-- removes the rest: name, email, consents, push tokens, saved uploads.
create function public.anonymise_account(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set name = null, email = null, phone = null, roles = '{traveller}' where user_id = p_user_id;
  delete from public.consents where user_id = p_user_id;
  delete from public.push_tokens where user_id = p_user_id;
  delete from public.media where owner_id = p_user_id;
  update public.reviews set status = 'hidden' where user_id = p_user_id;
  update public.referrals set expires_at = least(expires_at, now()) where owner_id = p_user_id;
  -- Bookings keep their phone (the M-PESA number on the payment records) but lose the link to the account.
  update public.bookings set user_id = null where user_id = p_user_id;
  update public.group_members set user_id = null, name = null where user_id = p_user_id;
end $$;
revoke execute on function public.anonymise_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymise_account(uuid) to service_role;

-- Review photos and clips: a private bucket; each traveller writes under their own folder.
-- Uploads are resumable (TUS) through Supabase Storage. Skipped where Storage isn't installed.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
    on conflict (id) do nothing;
    execute $p$create policy "travellers upload under their own folder" on storage.objects for insert to authenticated
      with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "travellers read their own uploads" on storage.objects for select to authenticated
      using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "travellers replace their own uploads" on storage.objects for update to authenticated
      using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;
