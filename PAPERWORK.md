# Paperwork track

Approvals that run on other people's timelines. Started week 1, beside the build; Daraja go-live
must land before real money moves (payments are built on the sandbox in weeks 7 to 12).
Update the status column as things move.

| # | Item | Needed by | Owner | Status |
|---|------|-----------|-------|--------|
| 1 | Daraja account and sandbox app | Slice 3a (week 7) | @Asibiko | Not started |
| 2 | Daraja go-live: STK Push, STK Query, Ratiba | Real payments (after week 12) | @Asibiko | Not started |
| 3 | Daraja B2C shortcode for payouts and refunds (separate, slower approval) | Slice 5 (week 15) | @Asibiko | Not started |
| 4 | Meta business verification and WhatsApp number | Slice 5 | @Asibiko | Not started |
| 5 | WhatsApp templates (list below) | Slice 3b (week 9) | @Asibiko | Not started |
| 6 | Africa's Talking account and sender ID | OTP in production | @Asibiko | Not started |
| 7 | Google Play developer account | First tester build | @Asibiko | Not started |
| 8 | ODPC registration as data controller | Before real users | @Asibiko | Not started |
| 9 | Escrow or aggregator partner for client funds | Before real money | @Asibiko | Not started |
| 10 | Domain for public pages and App Links | Slice 1 (week 3) | @Asibiko | Not started |
| 11 | 3 to 5 pilot providers in Naivasha | Recruit in Slice 2, test in Slice 5 | @Asibiko | Not started |
| 12 | Counsel review: privacy notice, cross-border data (Supabase region) | Before real users | @Asibiko | Not started |
| 13 | Native-speaker review of Kiswahili strings | Before launch | @Asibiko | Not started |

## WhatsApp templates to submit

Utility category unless noted. Variables in `{{ }}`. Submit each in English (`en`) and
Kiswahili (`sw`); the parameter order must match what the API sends (apps/api/src/services/plans.js).

| Template | Sent to | Purpose |
|---|---|---|
| `booking_request` | Provider | New booking with Accept / Decline quick replies |
| `booking_confirmed` | Traveller | Booking ref, dates, next payment |
| `payment_reminder` | Traveller | Instalment due in 3 days / 1 day. Body parameters, in order: {{1}} amount, {{2}} booking ref, {{3}} due date, {{4}} pay link |
| `payment_overdue` | Traveller | Missed instalment. {{1}} amount, {{2}} booking ref, {{3}} due date, {{4}} last day to pay, {{5}} pay link |
| `payment_received` | Traveller | Receipt with M-PESA code |
| `share_unpaid` | Group member | Your share of {{trip}} is still unpaid, pay link |
| `booking_cancelled` | Traveller, provider | Cancellation. To travellers: {{1}} booking ref, {{2}} payment deadline that was missed, {{3}} refund amount |
| `refund_sent` | Traveller | Refund amount and M-PESA code |
| `trip_tomorrow` | Traveller | Pick-up time, contacts, offline itinerary reminder |
| `review_request` | Traveller | Ask for a review (may be classed as marketing) |
