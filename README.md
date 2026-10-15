# Safiri

Book, pay in instalments with M-PESA, and travel Kenya in one app. Phase 1: weekend getaways
from Nairobi to Naivasha, the Maasai Mara, Diani and Amboseli. KES only, M-PESA only, Android first.

The full plan (design system, data model, slices, paperwork track) is the build plan document
"Safiri: Build Plan, Prompt and First Results" (13 Oct 2026).
Done: Slices **0** (Foundation), **1** (Discover), **2** (Build), **3a** (Pay once), **3b** (Instalments)
and **3c** (Group split). Next: test with 5 real travellers (build plan step 7), then Slice 4 (Travel).

## What's here

```
apps/
  mobile/     Expo app (JavaScript, Expo Router, dev builds)
  api/        Node.js + Fastify: money, inventory, messaging, public pages
packages/
  shared/     price calculator, phone numbers, booking states, zod schemas, en/sw strings
supabase/
  migrations/ tables, constraints, RLS policies, public photo bucket
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
cp apps/api/.env.example apps/api/.env   # fill SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, HOLD_TOKEN_SECRET
npm run api                              # http://localhost:3000/health
```

`DATABASE_URL` is a direct Postgres connection (hosted: the **session** pooler string). The API
uses it for quotes and 15-minute holds, and for its pg-boss job queue: every minute it releases
expired holds, and every hour it re-prices packages so display prices equal what a quote charges.

With no Africa's Talking keys in development, OTP texts are written to the API log instead of sent.

The API also serves the public web pages: `/` (home), `/d/naivasha`, `/p/naivasha-lakeside-weekend`,
`/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/privacy`. Add `?lang=sw` for Kiswahili. Upload the
destination photos to Supabase Storage once (needs the service-role key in `apps/api/.env`):

```sh
npm run photos:upload --workspace @safiri/api
```

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
npm test                  # shared unit tests, database + RLS tests (PGlite), real-Postgres concurrency tests, API tests
npm run db:check          # applies migrations + seed to a throwaway Postgres and prints counts
npm run db:seed           # regenerate supabase/seed.sql after editing supabase/seed/data.js
cd apps/mobile && npm run export:android && npm run check:bundle   # bundle + secrets scan
```

## M-PESA (Daraja sandbox)

1. At developer.safaricom.co.ke create an app with **Lipa na M-PESA Sandbox** (and later
   M-PESA Express Query). Copy its consumer key and secret.
2. Start a tunnel so Daraja can reach your API: `cloudflared tunnel --url http://localhost:3000`.
3. In `apps/api/.env` set `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`
   (sandbox: `174379`), `DARAJA_PASSKEY` (from the Daraja simulator page),
   `DARAJA_CALLBACK_BASE_URL` (the tunnel URL) and `DARAJA_CALLBACK_SECRET` (any long random string).
4. Check the settings, then send yourself a KES 1 test prompt:
   ```sh
   npm run daraja:check --workspace @safiri/api
   npm run daraja:check --workspace @safiri/api -- 0712345678
   ```
5. In the app: Book a trip, hold it, choose deposit or full, and pay. The booking turns
   `confirmed` once Safaricom confirms the payment, and the receipt arrives by SMS.

A payment only counts when it matches a payment the API started **and** an STK Query to
Safaricom confirms it, so forged callbacks do nothing. Replayed callbacks change nothing.
If a callback never arrives, the API settles the payment with STK Query within 2 minutes.

## Instalments and reminders

Every day at 08:00 (Nairobi) the API's `instalment-plans` job marks missed instalments
overdue, sends reminders 3 days and 1 day before each due date and once when overdue, and
cancels bookings whose final payment is still missing after the grace period (rooms go back on
sale; the refund the cancellation policy allows is recorded). Each reminder carries a one-tap
pay link (`/pay/<code>`, signed) that opens the app, or a plain web page whose single button
sends the M-PESA prompt, so no app is needed.

Reminders go by push (signed-in travellers who allowed reminders), plus WhatsApp once
`WHATSAPP_*` is set and Meta has approved the templates in PAPERWORK.md, with SMS as the backup.
M-PESA Ratiba auto-pay is not built yet: it needs Safaricom to enable Ratiba on the Daraja
account first (paperwork track); STK reminders cover every plan until then.

## Group split

At checkout the organiser can split a held booking with friends: names, M-PESA numbers, and
equal or custom shares (shares must add up to the total; the organiser takes any odd
shillings). The hold grows from 15 to 60 minutes so friends can pay. Each friend gets an
invite link (`/i/<code>`) that opens the app or a plain web page with one Pay button, so no app
is needed. The trip confirms as soon as paid shares reach the deposit; the rest is due by the
final due date, and the organiser is reminded 3 days and 1 day before who still owes. If a
friend won't pay, the organiser can cover their share. The organiser's screen updates live
(Supabase Realtime when signed in, plus polling every 3 seconds).

## App Links (package links open the app)

1. Buy the domain (paperwork track) and point it at the API.
2. Set `PUBLIC_BASE_URL=https://<domain>` for the API, and `EXPO_PUBLIC_WEB_URL` and `WEB_HOST` for app builds.
3. Get the signing key fingerprint with `eas credentials` and set `ANDROID_CERT_SHA256` for the API.
4. Open `https://<domain>/.well-known/assetlinks.json`, install the build, then on the phone run
   `adb shell pm get-app-links ke.safiri.app`: the domain should show as `verified`.

Structured data is checked in CI against the schema.org vocabulary (`apps/api/test/jsonld.test.js`).
After using a new schema.org type, run `npm run schema:refresh --workspace @safiri/api`.

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

Background photos are in `apps/mobile/assets/images/backgrounds/` (1280px) and `.../640/`, with
`CREDITS.md`. Two are bundled in the app (Welcome, Explore header); the app and web pages load the
rest from the `public-images` Storage bucket (`npm run photos:upload`), 640px in lists and data saver. The licences require
credit, which the app shows under Profile > Photo credits.
