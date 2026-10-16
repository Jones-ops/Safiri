# Build plan check (16 Oct 2026)

Item-by-item against "Safiri: Build Plan, Prompt and First Results" (13 Oct 2026). Status is one
of **Built** (and tested in CI), **Built, not field-tested** (needs a real account or real people),
**Partly**, **Not built**.

## Slices and their "done when"

| Slice | Status | Done-when result |
|---|---|---|
| 0 Foundation | Built | Fresh clone runs app and API with one command each; seed loads; CI green. Sign-in is **email one-time code**, not phone OTP (changed on 15 Oct: Africa's Talking SMS hook not yet approved; the M-PESA number is asked per booking). |
| 1 Discover | Built | Public pages pass the JSON-LD vocabulary test in CI; sitemap, robots, llms.txt, assetlinks served. Schema.org validator and "opens the app" need the domain and a signed build (PAPERWORK 10). |
| 2 Build | Built | 20 parallel holds for the last room create exactly one (real Postgres test); the app shows the server quote only; expired holds release (job). |
| 3a Pay once | Built, sandbox against a fake | Deposit moves held to confirmed; replayed callback changes nothing; every ledger transaction balances (DB test). Real Daraja sandbox needs the user's credentials in `apps/api/.env`. |
| 3b Instalments | Partly | Deposit + 3 instalments run end to end on a fast-forwarded clock including a missed payment (test). **Ratiba auto-pay not built**: needs Safaricom to enable Ratiba on the account; STK reminders are the designed fallback. |
| 3c Group split | Built | Friend with no app pays from a link; organiser's screen updates by Realtime and 3 s polling. |
| 4 Travel | Built, not field-tested | Itinerary, contacts and map pack saved on confirm; day-of local reminders. The airplane-mode / force-close check needs a development build on a phone. |
| 5 Provider and Agency | Built, not field-tested | Provider onboarding (6 steps), WhatsApp Accept/Decline buttons with SMS + web link fallback, calendar block/open, price seasons, agency packages with margin, publish/unpublish, bookings, payouts by B2C (settlement jobs). "3 real providers in under 5 minutes" needs pilot providers (PAPERWORK 11). |
| 6 Come back | Built | Only the traveller on a completed booking can review, once; a referral discount applies once per new traveller and rewards the referrer on confirmation (tests). Interrupted uploads resume: tus resumable uploads to Supabase Storage with fingerprint resume. |

## Non-negotiable security rules

| Rule | Status |
|---|---|
| App never holds Daraja credentials or the service-role key | Built. App uses the publishable key; CI bundle check fails on secret patterns. |
| Prices always computed on the server | Built. Quotes, holds, instalments, shares, package pricing and referral discounts are all server-side; the agency editor shows an estimate labelled as such and the server price after save. |
| Integer KES with one documented rounding rule | Built (`packages/shared/src/money.js`, README "Rules"). |
| RLS on every table, tested | Built. New tables this slice (B2C results) are private; policies tested in `supabase/tests`. |
| No secrets in the app bundle | Built (CI job). |

## Part A design and navigation

| Item | Status |
|---|---|
| Design tokens, light + dark, 48dp targets, status as icon + word | Built |
| Core components list | Built (all 12 named components exist) |
| One app, three modes switched from Profile; tab sets as specified | Built this slice (Provider: Requests, Calendar, Prices, Payouts; Agency: Packages, Bookings, Providers, Payouts) |
| Deep links for packages, pay and invite links | Built |

## Part B features

| Item | Status |
|---|---|
| Payment plans per package (deposit %, instalments, final deadline, grace, tiered cancel policy) | Built, editable by agencies in the app |
| Missed final payment: notify, grace, cancel and release | Built |
| Group split incl. organiser covers a share | Built |
| STK push only from API; IDs stored before prompt; idempotent callbacks confirmed by STK Query; reconciliation job | Built |
| Provider payouts via B2C on a schedule | Built (weekly job; needs B2C approval, PAPERWORK 3) |
| Escrow / aggregator swappable | Designed for (ledger accounts), partner not chosen |
| Double-entry ledger, derived balances, audit log | Built |
| WhatsApp templates with quick replies, SMS fallback with short link | Built; templates listed in PAPERWORK for submission |
| Reviews from completed bookings; referral capped and expiring | Built (KES 500, 10 uses, 180 days) |
| Cancellation with refund per policy | Built this slice (preview + confirm in app; refund by B2C) |

## Part C quality bar

| Item | Status |
|---|---|
| Android 8+, 2 GB, release < 30 MB, cold start < 3 s | Not measured: needs an EAS build (PAPERWORK 7 / EXPO_TOKEN in CI) |
| Low-data mode | Built (data saver setting, 640px images, map on Wi-Fi) |
| Offline itinerary, contacts, refs, tiles; local reminders; reviews queue until online | Built |
| English and Kiswahili from day one; KES and EAT formatting | Built; key-parity test in CI. Native-speaker review pending (PAPERWORK 13) |
| Kenya DPA: consent with purposes, minimal data, export and deletion, retention, bilingual notice | Built this slice: export (JSON) and delete (anonymise, 7-year retention of money records) in Profile and API |
| Funnel analytics events | Built (PostHog, consent-gated) |
| Unit tests pricing/plans; integration tests idempotency and double-booking | Built |
| Maestro E2E for booking | **Not built** |
| Stack: expo-video | **Not used** (no video playback yet; clips are uploaded, not played in-app) |
| Stack: phone OTP via Africa's Talking hook | Replaced by email OTP (see Slice 0) |

## HOW TO WORK

| Item | Status |
|---|---|
| Plan, then Part A, then go-ahead | Done in earlier sessions |
| Paperwork track with owner and status | PAPERWORK.md; all items still "Not started" on the user's side |
| Vertical slices, pause after each | Followed |
| End each slice with run instructions, demo script, done-when, gaps | README per slice; this file is the gaps list |
| Real-people tests (5 travellers after 3c, 3 to 5 providers in Slice 5) | **Not done**: needs people and a build |
| Max 3 questions, assumptions listed | Followed; assumptions in README and commit messages |
| Small files, .env.example lists every secret | Followed; `.env.example` updated this slice |

## Open points

1. Map tiles default to OpenFreeMap (`EXPO_PUBLIC_MAP_STYLE_URL`). Its terms allow this use today;
   switch to a paid provider or self-hosted tiles before launch if traffic grows.
2. Ratiba auto-pay and B2C payouts wait on Daraja approvals. Everything else is built so they
   plug in through config.
3. Admin-only actions with no screen yet: create a destination, create an agency, link a provider to
   an agency, grant roles. They are API calls (`/v1/manage/*`) and the `roles:grant` script.
