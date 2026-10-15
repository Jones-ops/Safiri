-- Sign-in is by email one-time code. The phone number is no longer the identity: it is the
-- M-PESA number each booking carries, typed at checkout. A profile keeps a phone only when the
-- account has one (seeded users).

alter table public.profiles alter column phone drop not null;
alter table public.profiles add column email text unique check (email = lower(email));

-- Every sign-up gets a profile, by email or (older accounts) by phone.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lang text := new.raw_user_meta_data ->> 'language';
begin
  if coalesce(new.email, '') = '' and coalesce(new.phone, '') = '' then
    return new;
  end if;
  insert into public.profiles (user_id, phone, email, language)
  values (
    new.id,
    nullif(regexp_replace(coalesce(new.phone, ''), '^\+', ''), ''), -- Supabase stores phones without the "+"
    nullif(lower(new.email), ''),
    case when lang in ('en', 'sw') then lang else 'en' end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

-- A confirmed email change in Supabase Auth follows through to the profile.
create function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = nullif(lower(new.email), ''), updated_at = now() where user_id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();
