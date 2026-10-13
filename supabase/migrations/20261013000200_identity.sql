-- Identity: the phone number is the identity. Minimal personal data (Kenya Data Protection Act 2019).

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  phone public.msisdn not null unique,
  name text check (char_length(name) between 1 and 80),
  roles public.user_role[] not null default '{traveller}',
  language text not null default 'en' check (language in ('en', 'sw')),
  low_data boolean not null default false
);

-- One row per user per purpose. Withdrawing sets withdrawn_at; granting again clears it.
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  purpose public.consent_purpose not null,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  notice_version text not null default '2026-10',
  unique (user_id, purpose)
);

-- Every phone sign-up gets a profile. Supabase stores auth phones without the "+".
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lang text := new.raw_user_meta_data ->> 'language';
begin
  if coalesce(new.phone, '') = '' then
    return new; -- email-only users (staff) have no traveller profile
  end if;
  insert into public.profiles (user_id, phone, language)
  values (
    new.id,
    regexp_replace(new.phone, '^\+', ''),
    case when lang in ('en', 'sw') then lang else 'en' end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.has_role(r public.user_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = auth.uid() and r = any (p.roles));
$$;
