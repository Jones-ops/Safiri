/**
 * Slice 5 and cancel/refund on a real Postgres (Daraja, WhatsApp, SMS and push faked):
 * provider requests on confirmation (WhatsApp buttons, SMS web page, app), onboarding,
 * calendar and prices, traveller cancellation with the policy refund, trip completion,
 * B2C payouts and refunds settled by Daraja's result callback.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { addDays, todayInKenya } = require('@safiri/shared');
const { startPostgres } = require('../../../supabase/tests/postgres-harness');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const SECRET = 'cb-secret';
const WA_SECRET = 'wa-app-secret';
const BASE = 'https://safiri.example';
let pg;
let db;
let app;
const users = {};

const daraja = {
  configured: true, b2cConfigured: true, pushes: [], b2c: [],
  async stkPush(req) {
    const n = this.pushes.push(req);
    return { merchantRequestId: `mr-${n}`, checkoutRequestId: `ws_CO_SUP_${n}`, customerMessage: 'ok' };
  },
  async stkQuery() { return { state: 'succeeded', resultCode: 0, resultDesc: 'ok' }; },
  async b2cPay(req) {
    const n = this.b2c.push(req);
    return { conversationId: `AG_${n}`, originatorConversationId: req.reference };
  },
};
const sms = { sent: [], async send(to, message) { this.sent.push({ to, message }); return { id: `sms-${this.sent.length}` }; } };
const whatsapp = { configured: true, sent: [], async sendTemplate(m) { this.sent.push(m); return { id: `wa-${this.sent.length}` }; } };
const push = { async send() { return { sent: 0, deadTokens: [] }; } };

const today = todayInKenya();
const inDays = (n) => addDays(today, n);
let n = 0;

test.before(async () => {
  pg = await startPostgres();
  db = new Pool({ connectionString: pg.url, max: 10 });
  for (const [name, phone] of [['wanjiru', '254700000001'], ['achieng', '254700000003'], ['agency', '254700000021'], ['ziwa', '254700000101'], ['kimana', '254700000114']]) {
    users[name] = (await db.query('select user_id from profiles where phone = $1', [phone])).rows[0].user_id;
  }
  await db.query(`update profiles set roles = '{traveller,admin}' where user_id = $1`, [users.wanjiru]);
  // Ziwa Shores answers requests itself; the other seeded providers auto-accept.
  await db.query(`update providers set auto_accept = false where name = 'Ziwa Shores Lodge'`);
  const config = loadConfig({
    NODE_ENV: 'test', HOLD_TOKEN_SECRET: 'sign', DARAJA_CALLBACK_SECRET: SECRET, PUBLIC_BASE_URL: BASE, WHATSAPP_APP_SECRET: WA_SECRET, WHATSAPP_VERIFY_TOKEN: 'verify-me',
  });
  app = await buildApp(config, {
    supabase: null, db, daraja, sms, whatsapp, push, profiles: {}, catalogue: {},
    verifyToken: async (token) => (users[token] ? { sub: users[token] } : null),
  });
});

test.after(async () => {
  await app?.close();
  await db?.end();
  await pg?.stop();
});

const as = (who) => ({ authorization: `Bearer ${who}` });
const lastCheckout = () => `ws_CO_SUP_${daraja.pushes.length}`;
const callback = (checkoutRequestId, amount) =>
  app.inject({ method: 'POST', url: `/hooks/mpesa/stk/${SECRET}`, payload: { Body: { stkCallback: {
    MerchantRequestID: 'mr', CheckoutRequestID: checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
    CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: `TS${checkoutRequestId.replace(/\D/g, '').padStart(8, '0')}` }] },
  } } } });

/** A guest books the Naivasha weekend (Ziwa room + shuttle + boat) and pays the deposit. */
async function confirmedBooking(startDay = 40) {
  n += 1;
  const ip = `10.5.0.${n}`;
  const phone = `07660${String(n).padStart(5, '0')}`;
  const quote = (await app.inject({ method: 'POST', url: '/v1/quotes', remoteAddress: ip, payload: { packageSlug: 'naivasha-lakeside-weekend', startDate: inDays(startDay), travellers: 2 } })).json();
  const hold = (await app.inject({ method: 'POST', url: '/v1/holds', remoteAddress: ip, payload: { quoteId: quote.id, phone } })).json();
  const start = (await app.inject({ method: 'POST', url: '/v1/payments', remoteAddress: ip, payload: { bookingId: hold.bookingId, option: 'deposit', phone, token: hold.holdToken } })).json();
  await callback(lastCheckout(), start.amountKes);
  return { ...hold, phone: `254${phone.slice(1)}`, ip };
}

const items = async (bookingId) =>
  (await db.query(`select pr.name, bi.provider_status::text as status from booking_items bi join providers pr on pr.id = bi.provider_id where bi.booking_id = $1 order by pr.name, bi.date`, [bookingId])).rows;
const codeFrom = (payload) => payload.split(':')[1];

test('a confirmed booking sends each non-auto-accepting provider one request with Accept/Decline buttons', async () => {
  whatsapp.sent.length = 0;
  const b = await confirmedBooking();
  const after = await items(b.bookingId);
  assert.ok(after.filter((i) => i.name === 'Ziwa Shores Lodge').every((i) => i.status === 'pending'), 'the lodge must answer');
  assert.ok(after.filter((i) => i.name !== 'Ziwa Shores Lodge').every((i) => i.status === 'auto_accepted'), 'seeded providers auto-accept');
  const request = whatsapp.sent.find((m) => m.template === 'booking_request');
  assert.ok(request, 'one WhatsApp request');
  assert.equal(request.to, '254700000101', "to the provider's WhatsApp number");
  assert.equal(request.params[3], '18,000', 'payout: 4,500 x 2 nights x 2 guests');
  assert.deepEqual(request.buttons.map((p) => p.split(':')[0]), ['accept', 'decline']);
  assert.equal(whatsapp.sent.filter((m) => m.template === 'booking_request').length, 1, 'one request, not one per night');
  const sent = await db.query(`select count(*)::int c from booking_items where booking_id = $1 and request_sent_at is not null`, [b.bookingId]);
  assert.equal(sent.rows[0].c, 2);
});

test('the provider accepts in the app; the traveller is told; a second answer is refused', async () => {
  sms.sent.length = 0;
  const b = await confirmedBooking();
  const list = await app.inject({ url: '/v1/provider/requests', headers: as('ziwa') });
  assert.equal(list.statusCode, 200, list.body);
  const req = list.json().requests.find((r) => r.bookingId === b.bookingId);
  assert.equal(req.status, 'pending');
  assert.equal(req.payoutKes, 18000);
  assert.equal(req.travellers, 2);
  assert.ok(req.respondBy);

  assert.equal((await app.inject({ url: '/v1/provider/requests', headers: as('agency') })).statusCode, 403, 'agencies are not providers');
  const ok = await app.inject({ method: 'POST', url: `/v1/provider/requests/${req.code}/respond`, headers: as('ziwa'), payload: { accept: true } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().status, 'accepted');
  assert.ok((await items(b.bookingId)).every((i) => i.status !== 'pending'));
  // WhatsApp is configured in this test, so the traveller is told on WhatsApp (SMS is the backup).
  const told = whatsapp.sent.find((m) => m.template === 'booking_confirmed' && m.to === b.phone);
  assert.ok(told, 'the traveller is told the provider confirmed');
  assert.equal(told.params[1], 'Ziwa Shores Lodge');
  const again = await app.inject({ method: 'POST', url: `/v1/provider/requests/${req.code}/respond`, headers: as('ziwa'), payload: { accept: false } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error, 'already_answered');
  // Another provider cannot answer it.
  assert.equal((await app.inject({ method: 'POST', url: `/v1/provider/requests/${req.code}/respond`, headers: as('kimana'), payload: { accept: true } })).statusCode, 404);
});

test('a WhatsApp Decline tap (signed, from the provider\'s number) declines and alerts the agency', async () => {
  const b = await confirmedBooking();
  whatsapp.sent.length = 0;
  sms.sent.length = 0;
  assert.equal(await app.services.providers.sendRequests(b.bookingId), 0, 'already sent on confirmation: nothing new');
  const code = codeFrom(await listCodes(b.bookingId));
  const tap = (payload, from, secret = WA_SECRET) => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ type: 'button', from, id: 'wamid.1', button: { payload, text: 'Decline' } }] } }] }] });
    return app.inject({ method: 'POST', url: '/hooks/whatsapp', payload: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex') } });
  };
  assert.equal((await tap(`decline:${code}`, '254700000101', 'wrong')).statusCode, 401, 'bad signature');
  await tap(`decline:${code}`, '254799999999');
  assert.ok((await items(b.bookingId)).some((i) => i.status === 'pending'), 'a tap from another number is ignored');
  const res = await tap(`decline:${code}`, '254700000101');
  assert.equal(res.statusCode, 200);
  assert.ok((await items(b.bookingId)).filter((i) => i.name === 'Ziwa Shores Lodge').every((i) => i.status === 'declined'));
  const alert = whatsapp.sent.find((m) => m.template === 'provider_declined' && m.to === '254700000021');
  assert.ok(alert, 'the agency owner is alerted');
  assert.equal(alert.params[1], 'Ziwa Shores Lodge');
  const verify = await app.inject({ url: '/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345' });
  assert.equal(verify.body, '12345');
});

async function listCodes(bookingId) {
  const req = (await app.inject({ url: '/v1/provider/requests', headers: as('ziwa') })).json().requests.find((r) => r.bookingId === bookingId);
  return `x:${req.code}`;
}

test('the SMS fallback: Accept on a plain web page, no app', async () => {
  const b = await confirmedBooking();
  const code = codeFrom(await listCodes(b.bookingId));
  const page = await app.inject({ url: `/r/${code}` });
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers['x-robots-tag'], 'noindex');
  assert.match(page.body, /Booking request for Ziwa Shores Lodge/);
  assert.match(page.body, /You receive: KES 18,000/);
  const crossSite = await app.inject({ method: 'POST', url: `/r/${code}`, payload: 'action=accept', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.statusCode, 403, 'another site cannot answer for the provider');
  const accepted = await app.inject({ method: 'POST', url: `/r/${code}`, payload: 'action=accept', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.match(accepted.body, /You accepted this booking/);
  assert.ok((await items(b.bookingId)).every((i) => i.status !== 'pending'));
  assert.equal((await app.inject({ url: '/r/not-a-code' })).statusCode, 404);
});

test('unanswered requests expire after 24 hours and the agency is told to swap the provider', async () => {
  const b = await confirmedBooking();
  whatsapp.sent.length = 0;
  await db.query(`update booking_items set request_sent_at = now() - interval '25 hours' where booking_id = $1`, [b.bookingId]);
  assert.equal(await app.services.providers.expireRequests(), 1);
  assert.ok((await items(b.bookingId)).filter((i) => i.name === 'Ziwa Shores Lodge').every((i) => i.status === 'expired'));
  assert.ok(whatsapp.sent.some((m) => m.template === 'provider_no_reply' && m.to === '254700000021'), 'the agency is told to swap the provider');
  // Twice in a row: the alert is not repeated.
  assert.equal(await app.services.providers.expireRequests(), 0);
});

test('a provider signs up from the app, is unverified until an admin checks, then manages calendar and prices', async () => {
  const destinationId = (await db.query(`select id from destinations where slug = 'naivasha'`)).rows[0].id;
  const res = await app.inject({ method: 'POST', url: '/v1/provider/onboard', headers: as('achieng'), remoteAddress: '10.5.9.1', payload: {
    type: 'guide', name: 'Achieng Walks', destinationId, locationName: 'Karagita, Naivasha', whatsappPhone: '0700 000 003', payoutPhone: '0700000003',
    listing: { title: 'Guided lakeshore walk', kind: 'activity', unit: 'person', capacity: 12, netKes: 1200 },
  } });
  assert.equal(res.statusCode, 201, res.body);
  const p = res.json();
  assert.equal(p.verifiedAt, null);
  assert.equal(p.listings.length, 1);
  const listingId = p.listings[0].id;
  const roles = (await db.query(`select roles::text[] from profiles where user_id = $1`, [users.achieng])).rows[0].roles;
  assert.ok(roles.includes('provider'));
  const days = (await db.query('select count(*)::int c from availability where listing_id = $1', [listingId])).rows[0].c;
  assert.equal(days, 181, 'open for 180 days');
  assert.equal((await app.inject({ url: '/v1/listings' })).statusCode, 404);
  const pub = await db.query(`select 1 from listings l join providers pr on pr.id = l.provider_id where l.id = $1 and pr.verified_at is not null`, [listingId]);
  assert.equal(pub.rowCount, 0, 'not bookable until verified');

  const verify = await app.inject({ method: 'POST', url: `/v1/manage/providers/${p.id}/verify`, headers: as('wanjiru'), payload: { verified: true } });
  assert.equal(verify.statusCode, 204);

  // A whole month ahead (the current month only has its remaining days open).
  const month = inDays(40).slice(0, 7);
  const first = `${month}-10`;
  const second = `${month}-11`;
  const cal = await app.inject({ url: `/v1/provider/listings/${listingId}/calendar?month=${month}`, headers: as('achieng') });
  assert.equal(cal.statusCode, 200, cal.body);
  assert.ok(cal.json().days.length >= 28, `${cal.json().days.length} days`);
  const block = await app.inject({ method: 'POST', url: `/v1/provider/listings/${listingId}/block`, headers: as('achieng'), payload: { dates: [first, second], blocked: true } });
  assert.equal(block.statusCode, 204);
  const blocked = (await app.inject({ url: `/v1/provider/listings/${listingId}/calendar?month=${month}`, headers: as('achieng') })).json().days.filter((d) => d.blocked);
  assert.deepEqual(blocked.map((d) => d.date), [first, second]);
  // A blocked day cannot be quoted.
  const q = await app.inject({ method: 'POST', url: '/v1/quotes', remoteAddress: '10.5.9.2', payload: { destinationSlug: 'naivasha', nights: 0, startDate: first, travellers: 2, items: [{ listingId, day: 1, qty: 1 }] } });
  assert.equal(q.json().available, false);

  // Ziwa cannot block a day with a confirmed booking on it, and cannot touch Achieng's listing.
  const ziwaRoom = (await db.query(`select id from listings where title = 'Lake-view room, breakfast included'`)).rows[0].id;
  const booked = await confirmedBooking(); // so the lodge certainly has a booked day
  const busyDay = (await db.query(`select date::text from booking_items where booking_id = $1 and listing_id = $2 limit 1`, [booked.bookingId, ziwaRoom])).rows[0].date;
  const busy = await app.inject({ method: 'POST', url: `/v1/provider/listings/${ziwaRoom}/block`, headers: as('ziwa'), payload: { dates: [busyDay], blocked: true } });
  assert.equal(busy.statusCode, 409);
  assert.equal(busy.json().error, 'date_in_use');
  assert.equal((await app.inject({ url: `/v1/provider/listings/${listingId}/prices`, headers: as('ziwa') })).statusCode, 404);

  const prices = await app.inject({ method: 'PUT', url: `/v1/provider/listings/${listingId}/prices`, headers: as('achieng'), payload: {
    seasons: [{ seasonStart: inDays(-1), seasonEnd: inDays(365), netKes: 1200 }, { seasonStart: '2026-12-20', seasonEnd: '2027-01-05', netKes: 1800 }],
  } });
  assert.equal(prices.statusCode, 200, prices.body);
  assert.equal(prices.json().seasons.length, 2);
});

test('the traveller sees the exact refund, cancels, the rooms return and the refund goes out by B2C', async () => {
  const b = await confirmedBooking(45); // 45 days ahead: 100% refund tier
  sms.sent.length = 0;
  const preview = await app.inject({ url: `/v1/bookings/${b.bookingId}/cancel?token=${b.holdToken}` });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().refundPct, 100);
  assert.equal(preview.json().refundKes, preview.json().paidKes);
  assert.equal((await app.inject({ url: `/v1/bookings/${b.bookingId}/cancel` })).statusCode, 404, 'no token, no preview');

  const roomsBefore = (await db.query(`select sum(a.units_booked)::int s from availability a join booking_items bi on bi.listing_id = a.listing_id and bi.date = a.date where bi.booking_id = $1`, [b.bookingId])).rows[0].s;
  const cancel = await app.inject({ method: 'POST', url: `/v1/bookings/${b.bookingId}/cancel`, remoteAddress: b.ip, payload: { token: b.holdToken } });
  assert.equal(cancel.statusCode, 200, cancel.body);
  assert.equal(cancel.json().outcome, 'cancelled');
  const roomsAfter = (await db.query(`select sum(a.units_booked)::int s from availability a join booking_items bi on bi.listing_id = a.listing_id and bi.date = a.date where bi.booking_id = $1`, [b.bookingId])).rows[0].s;
  assert.ok(roomsAfter < roomsBefore, 'rooms back on sale');
  assert.ok(whatsapp.sent.some((m) => m.template === 'booking_cancelled' && m.to === '254700000101'), 'the lodge is told its dates are free');
  const refund = (await db.query(`select id, status, amount_kes from refunds where booking_id = $1`, [b.bookingId])).rows[0];
  assert.equal(refund.status, 'pending');
  assert.equal(refund.amount_kes, preview.json().paidKes);

  assert.equal(await app.services.settlement.runRefunds(), 1);
  const b2c = daraja.b2c.at(-1);
  assert.equal(b2c.msisdn, b.phone);
  assert.equal(b2c.amountKes, refund.amount_kes);
  const result = await app.inject({ method: 'POST', url: `/hooks/mpesa/b2c/${SECRET}`, payload: { Result: {
    ResultType: 0, ResultCode: 0, ResultDesc: 'ok', OriginatorConversationID: refund.id, ConversationID: `AG_${daraja.b2c.length}`, TransactionID: 'TB2C000001',
    ResultParameters: { ResultParameter: [{ Key: 'TransactionAmount', Value: refund.amount_kes }, { Key: 'TransactionReceipt', Value: 'TB2C000001' }] },
  } } });
  assert.equal(result.statusCode, 200);
  const paid = (await db.query(`select status, mpesa_receipt from refunds where id = $1`, [refund.id])).rows[0];
  assert.deepEqual(paid, { status: 'paid', mpesa_receipt: 'TB2C000001' });
  // Replayed result changes nothing.
  await app.inject({ method: 'POST', url: `/hooks/mpesa/b2c/${SECRET}`, payload: { Result: { ResultCode: 0, OriginatorConversationID: refund.id, ConversationID: `AG_${daraja.b2c.length}`, TransactionID: 'TB2C000001' } } });
  const entries = (await db.query(`select count(*)::int c from ledger_entries where ref_type = 'refund' and ref_id = $1`, [refund.id])).rows[0].c;
  assert.equal(entries, 2);
});

test('a trip that ended becomes completed; providers are owed and paid by B2C', async () => {
  const booking = (await db.query(`select id, ref from bookings where ref = 'SAF-FP4ID1'`)).rows[0];
  await db.query(`update bookings set start_date = current_date - 5, end_date = current_date - 3 where id = $1`, [booking.id]);
  await db.query(`update booking_items set date = date - 15 where booking_id = $1`, [booking.id]);
  assert.equal(await app.services.settlement.completeEndedTrips({ today }), 1);
  assert.equal((await db.query(`select status from bookings where id = $1`, [booking.id])).rows[0].status, 'completed');
  assert.equal(await app.services.settlement.completeEndedTrips({ today }), 0, 'recognised once');

  const before = (await app.inject({ url: '/v1/provider/payouts', headers: as('kimana') })).json();
  const kimana = before.providers.find((p) => p.name === 'Kimana View Lodge');
  assert.equal(kimana.owedKes, 8000 * 2 * 2, 'two nights for two people at the lodge net rate');

  daraja.b2c.length = 0;
  const sent = await app.services.settlement.runPayouts();
  assert.ok(sent >= 1);
  const payout = (await db.query(`select id, amount_kes, conversation_id, status from payouts where provider_id = $1 and status = 'processing'`, [kimana.id])).rows[0];
  assert.equal(payout.amount_kes, kimana.owedKes);
  assert.equal(daraja.b2c.find((x) => x.reference === payout.id).msisdn, kimana.payoutPhone);

  await app.inject({ method: 'POST', url: `/hooks/mpesa/b2c/${SECRET}`, payload: { Result: { ResultCode: 0, ResultDesc: 'ok', OriginatorConversationID: payout.id, ConversationID: payout.conversation_id, TransactionID: 'TPAY000001' } } });
  const after = (await app.inject({ url: '/v1/provider/payouts', headers: as('kimana') })).json();
  assert.equal(after.providers.find((p) => p.id === kimana.id).owedKes, 0);
  assert.equal(after.history[0].status, 'paid');
  assert.equal(after.history[0].receipt, 'TPAY000001');
  assert.equal(await app.services.settlement.runPayouts(), 0, 'nothing more owed');
});

test('every ledger transaction balances', async () => {
  const { rows } = await db.query(`select txn_id from ledger_entries group by txn_id having sum(debit_kes) <> sum(credit_kes)`);
  assert.deepEqual(rows, []);
});
