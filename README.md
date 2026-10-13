# Safiri

Book, pay in instalments with M-PESA, and travel Kenya in one app. Phase 1: weekend getaways
from Nairobi to Naivasha, the Maasai Mara, Diani and Amboseli. KES only, M-PESA only, Android first.

The full plan (design system, data model, slices, paperwork track) is the build plan document
"Safiri: Build Plan, Prompt and First Results" (13 Oct 2026).
This repo is at the end of **Slice 0: Foundation**.

## What's here

```
apps/
  mobile/     Expo app (JavaScript, Expo Router, dev builds)
  api/        Node.js + Fastify: money, inventory, messaging, public pages
packages/
  shared/     price calculator, phone numbers, booking states, zod schemas, en/sw strings
supabase/
  migrations/ tables, constraints, RLS policies (7 files)
  seed/       seed data (data.js) and the generator that writes seed.sql
  tests/      schema and RLS tests, run in PGlite (no Docker needed)
.github/workflows/ci.yml   lint, tests, bundle secrets check, EAS preview build
```

## Run it

You need Node 24, and for local Supabase, Docker. The app needs an Android phone or emulator
with a Safiri **development build** (not Expo Go: MMKV and, later, MapLibre need native code).

### 1. Install

```sh
npm install
```

### 2. Database (Supabase)

Local, with Docker:

```sh
# The Send SMS hook secret is shared by Supabase and the API. Make one:
node -e "console.log('v1,whsec_'+require('crypto').randomBytes(32).toString('base64'))"
export SEND_SMS_HOOK_SECRET='v1,whsec_...'      # PowerShell: $env:SEND_SMS_HOOK_SECRET='v1,whsec_...'

npx supabase start       # prints the API URL, publishable (anon) key and service-role key
npx supabase db reset    # applies supabase/migrations and supabase/seed.sql
```

Hosted project: `npx supabase link --project-ref <ref>`, then `npx supabase db push`, then run
`supabase/seed.sql` in the SQL editor (development projects only). In the dashboard, enable the
Phone provider and add the Send SMS hook (HTTP, `https://<api-host>/hooks/send-sms`).

Seeded phone numbers sign in with code `123456` locally (see `supabase/config.toml`):
Wanjiru `0700 000 001`, Otieno `0700 000 002`, Achieng `0700 000 003`, agency `0700 000 021`.

### 3. API

```sh
cp apps/api/.env.example apps/api/.env   # fill SUPABASE_SERVICE_ROLE_KEY and SEND_SMS_HOOK_SECRET
npm run api                              # http://localhost:3000/health
```

With no Africa's Talking keys in development, OTP texts are written to the API log instead of sent.
Daraja callbacks (Slice 3a) need a public HTTPS URL: `npx cloudflared tunnel --url http://localhost:3000`.

### 4. App

```sh
cp apps/mobile/.env.example apps/mobile/.env   # Supabase URL + publishable key, API URL (use your LAN IP)
cd apps/mobile
npx expo run:android          # first time only: builds and installs the dev build (needs Android SDK)
                              # or: npx eas build --profile development --platform android
cd ../.. && npm run mobile    # then every day: starts Metro for the dev build
```

### Checks

```sh
npm run lint
npm test                  # shared unit tests, database + RLS tests (PGlite), API tests
npm run db:check          # applies migrations + seed to a throwaway Postgres and prints counts
npm run db:seed           # regenerate supabase/seed.sql after editing supabase/seed/data.js
cd apps/mobile && npm run export:android && npm run check:bundle   # bundle + secrets scan
```

## Rules that hold everywhere

- **Money is integer KES.** One rounding rule, in `packages/shared/src/money.js`: margin rounds
  half up; the traveller price rounds up to the next KES 50; the platform fee absorbs the rounding;
  the deposit rounds up; uneven instalments put the remainder on the last one.
- **The app never holds secrets.** It uses the publishable key and RLS for reads and calls the API
  for anything touching money or inventory. CI fails if a secret appears in the bundle.
- **Prices are computed on the server.** The app shows a quote; the API recomputes and locks it.
- **RLS is on every table, and new tables start with no access.** The first migration revokes
  default grants, so each new table needs explicit `grant` + `create policy` statements, and tests.
- **Ledger and audit log are append-only.** Every ledger transaction must balance at commit.
- **English and Kiswahili for every string.** A test fails if `en.json` and `sw.json` differ in keys.
  A native speaker reviews `sw.json` before launch.

## Photos

Background photos are in `apps/mobile/assets/images/backgrounds/` with `CREDITS.md`. Two are
bundled (Welcome, Explore); the rest go to Supabase Storage in Slice 1. The licences require
credit, which the app shows under Profile > Photo credits.
