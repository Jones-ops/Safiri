/**
 * Slice 3a done-when, end to end through the API on a real Postgres (Daraja faked):
 *   - a sandbox deposit moves the booking from held to confirmed
 *   - replaying the same callback changes nothing
 *   - every ledger transaction balances
 * plus forged callbacks, STK Query disagreeing, cancellations, reconciliation without a
 * callback, money arriving after the hold ended, the M-PESA limit and claiming a guest booking.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { addDays, todayInKenya } = require('@safiri/shared');
const { startPostgres } = require('../../../supabase/tests/postgres-harness');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const SECRET = 'callback-secret-123';
let pg;
let db;
let app;
let otienoId;

/** A fake Daraja: records STK pushes; STK Query answers from `queryAnswers` (default success). */
const daraja = {
  configured: true,
  pushes: [],
  queryAnswers: new Map(),
  async stkPush(req) {
    const n = this.pushes.push(req);
    return { merchantRequestId: `mr-${n}`, checkoutRequestId: `ws_CO_TEST_${n}`, customerMessage: 'Success. Request accepted for processing' };
  },
  async stkQuery(checkoutRequestId) {
    const state = this.queryAnswers.get(checkoutRequestId) || 'succeeded';
    return { state, resultCode: state === 'succeeded' ? 0 : 1, resultDesc: state };
  },
};
const sms = { sent: [], async send(to, message) { this.sent.push({ to, message }); return { id: `sms-${this.sent.length}` }; } };

const inDays = (n) => addDays(todayInKenya(), n);

// Each simulated traveller gets their own phone and IP, so the per-phone hold limit and the
// per-IP rate limits (which have their own tests) don't trip across unrelated tests.
let travellerNo = 0;
const nextTraveller = () => {
  travellerNo += 1;
  return { phone: `07220${String(travellerNo).padStart(5, '0')}`, ip: `10.0.${Math.floor(travellerNo / 250)}.${travellerNo % 250}` };
};

test.before(async () => {
  pg = await startPostgres();
  db = new Pool({ connectionString: pg.url, max: 10 });
  otienoId = (await db.query(`select user_id from profiles where phone = '254700000002'`)).rows[0].user_id;
  const config = loadConfig({ NODE_ENV: 'test', HOLD_TOKEN_SECRET: 'hold-secret', DARAJA_CALLBACK_SECRET: SECRET });
  app = await buildApp(config, {
    supabase: null,
    db,
    daraja,
    sms,
    verifyToken: async (token) => (token === 'otieno' ? { sub: otienoId, phone: '254700000002' } : null),
    profiles: {},
    catalogue: {},
  });
});

test.after(async () => {
  await app?.close();
  await db?.end();
  await pg?.stop();
});

async function heldBooking({ slug = 'naivasha-lakeside-weekend', startDay, travellers = 2, phone } = {}) {
  const who = nextTraveller();
  // Spread trips over dates so the lodges (12 rooms) don't sell out across tests.
  startDay = startDay ?? 30 + (travellerNo % 50);
  const quote = await app.inject({ method: 'POST', url: '/v1/quotes', remoteAddress: who.ip, payload: { packageSlug: slug, startDate: inDays(startDay), travellers } });
  assert.equal(quote.statusCode, 201, quote.body);
  const hold = await app.inject({ method: 'POST', url: '/v1/holds', remoteAddress: who.ip, payload: { quoteId: quote.json().id, phone: phone || who.phone } });
  assert.equal(hold.statusCode, 201, hold.body);
  return { ...hold.json(), phone: phone || who.phone, ip: who.ip };
}

const pay = (b, option, phone = b.phone) =>
  app.inject({ method: 'POST', url: '/v1/payments', remoteAddress: b.ip, payload: { bookingId: b.bookingId, option, phone, token: b.holdToken } });

// M-PESA receipt numbers are unique (the database enforces it), so each payment gets its own.
const receiptFor = (checkoutRequestId) => `TR${checkoutRequestId.replace(/\D/g, '').padStart(8, '0')}`;

function callback(checkoutRequestId, { resultCode = 0, amount, receipt = receiptFor(checkoutRequestId) } = {}) {
  const stkCallback = { MerchantRequestID: 'mr', CheckoutRequestID: checkoutRequestId, ResultCode: resultCode, ResultDesc: resultCode === 0 ? 'The service request is processed successfully.' : 'Request cancelled by user' };
  if (resultCode === 0) {
    stkCallback.CallbackMetadata = { Item: [
      { Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: receipt },
      { Name: 'TransactionDate', Value: 20261013120530 }, { Name: 'PhoneNumber', Value: 254722000001 },
    ] };
  }
  return app.inject({ method: 'POST', url: `/hooks/mpesa/stk/${SECRET}`, payload: { Body: { stkCallback } } });
}

const lastCheckoutId = () => `ws_CO_TEST_${daraja.pushes.length}`;

/** Everything a payment can touch, to prove a replay changes nothing. */
async function snapshot(bookingId) {
  const q = async (sql) => (await db.query(sql, [bookingId])).rows;
  return {
    booking: await q('select status, paid_kes, hold_expires_at from bookings where id = $1'),
    payments: await q('select status, mpesa_receipt, amount_kes from payments where booking_id = $1 order by created_at'),
    ledger: await q('select count(*)::int n, sum(debit_kes)::int d, sum(credit_kes)::int c from ledger_entries where booking_id = $1'),
    plan: await q('select seq, amount_kes, paid_kes, status from instalments where booking_id = $1 order by seq'),
    rooms: await q(`select a.listing_id, a.date, bi.units, a.units_held, a.units_booked from availability a
                    join booking_items bi on bi.listing_id = a.listing_id and bi.date = a.date where bi.booking_id = $1 order by 1, 2`),
    refunds: await q('select count(*)::int n from refunds where booking_id = $1'),
    texts: sms.sent.length,
  };
}

test('checkout offers a deposit with a dated schedule, or pay in full', async () => {
  const b = await heldBooking({ startDay: 40 });
  assert.equal((await app.inject({ url: `/v1/bookings/${b.bookingId}` })).statusCode, 404, 'no token, no booking');
  const res = await app.inject({ url: `/v1/bookings/${b.bookingId}?token=${b.holdToken}` });
  assert.equal(res.statusCode, 200);
  const s = res.json();
  assert.equal(s.status, 'held');
  assert.equal(s.totalKes, 31400);
  const deposit = s.options.find((o) => o.option === 'deposit');
  assert.equal(deposit.amountKes, 7850);
  assert.equal(deposit.schedule.length, 4);
  assert.equal(deposit.schedule.at(-1).dueDate, inDays(33), 'last payment 7 days before travel');
  assert.deepEqual(s.options.find((o) => o.option === 'full'), { option: 'full', amountKes: 31400, overLimit: false });
});

test('a sandbox deposit moves the booking from held to confirmed', async () => {
  const b = await heldBooking();
  const before = await snapshot(b.bookingId);
  const start = await pay(b, 'deposit');
  assert.equal(start.statusCode, 201, start.body);
  assert.equal(start.json().status, 'pending');
  assert.equal(start.json().amountKes, 7850);
  const push = daraja.pushes.at(-1);
  assert.deepEqual(
    { msisdn: push.msisdn, amountKes: push.amountKes, accountReference: push.accountReference },
    { msisdn: `254${b.phone.slice(1)}`, amountKes: 7850, accountReference: b.ref },
  );

  const cb = await callback(lastCheckoutId(), { amount: 7850, receipt: 'TJD4AB12CD' });
  assert.deepEqual(cb.json(), { ResultCode: 0, ResultDesc: 'Accepted' });

  const after = await snapshot(b.bookingId);
  assert.equal(after.booking[0].status, 'confirmed');
  assert.equal(after.booking[0].paid_kes, 7850);
  assert.equal(after.booking[0].hold_expires_at, null);
  assert.deepEqual(after.payments.map((p) => [p.status, p.mpesa_receipt]), [['succeeded', 'TJD4AB12CD']]);
  assert.deepEqual(after.plan.map((i) => [i.seq, i.status]), [[0, 'paid'], [1, 'due'], [2, 'due'], [3, 'due']]);
  for (const [i, room] of after.rooms.entries()) {
    assert.equal(room.units_held, before.rooms[i].units_held - room.units, 'no longer held');
    assert.equal(room.units_booked, before.rooms[i].units_booked + room.units, 'now booked');
  }
  assert.match(sms.sent.at(-1).message, /KES 7,850 received \(M-PESA TJD4AB12CD\)\. Booking SAF-.{6} is confirmed\. Next payment KES 7,850 due/);

  const status = await app.inject({ url: `/v1/payments/${start.json().paymentId}?token=${b.holdToken}` });
  assert.equal(status.json().status, 'succeeded');
  assert.equal(status.json().bookingStatus, 'confirmed');
  assert.equal(status.json().receipt, 'TJD4AB12CD');

  // Replaying the same callback changes nothing.
  const replay = await callback(lastCheckoutId(), { amount: 7850, receipt: 'TJD4AB12CD' });
  assert.equal(replay.statusCode, 200);
  await callback(lastCheckoutId(), { amount: 7850, receipt: 'TJD4AB12CD' });
  assert.deepEqual(await snapshot(b.bookingId), after);
  const outcomes = (await db.query(`select outcome from mpesa_callbacks where checkout_request_id = $1 order by created_at`, [lastCheckoutId()])).rows;
  assert.deepEqual(outcomes.map((o) => o.outcome), ['confirmed', 'already_confirmed', 'already_confirmed']);
});

test('paying in full makes the booking fully paid', async () => {
  const b = await heldBooking({ slug: 'naivasha-day-escape', startDay: 30 });
  await pay(b, 'full');
  await callback(lastCheckoutId(), { amount: 16200 });
  const s = (await app.inject({ url: `/v1/bookings/${b.bookingId}?token=${b.holdToken}` })).json();
  assert.equal(s.status, 'fully_paid');
  assert.equal(s.paidKes, 16200);
  assert.equal(s.nextPayment, null);
  assert.match(sms.sent.at(-1).message, /fully paid/);
});

test('forged and wrong-secret callbacks change nothing', async () => {
  const b = await heldBooking();
  await pay(b, 'deposit');
  const before = await snapshot(b.bookingId);
  assert.equal((await callback('ws_CO_FORGED', { amount: 7850 })).statusCode, 200);
  const wrongSecret = await app.inject({ method: 'POST', url: '/hooks/mpesa/stk/guess', payload: { Body: { stkCallback: { CheckoutRequestID: lastCheckoutId(), ResultCode: 0 } } } });
  assert.equal(wrongSecret.statusCode, 404);
  assert.deepEqual(await snapshot(b.bookingId), before);
  const outcome = (await db.query(`select outcome from mpesa_callbacks where checkout_request_id = 'ws_CO_FORGED'`)).rows[0].outcome;
  assert.equal(outcome, 'unknown_payment');
});

test('a "success" callback that STK Query does not confirm is not paid', async () => {
  const b = await heldBooking();
  await pay(b, 'deposit');
  daraja.queryAnswers.set(lastCheckoutId(), 'failed');
  await callback(lastCheckoutId(), { amount: 7850 });
  const s = await snapshot(b.bookingId);
  assert.equal(s.booking[0].status, 'held');
  assert.equal(s.payments[0].status, 'failed');
  assert.equal(s.ledger[0].n, 0, 'no money recorded');
});

test('a callback with the wrong amount is not trusted', async () => {
  const b = await heldBooking();
  await pay(b, 'deposit');
  await callback(lastCheckoutId(), { amount: 1 });
  assert.equal((await snapshot(b.bookingId)).booking[0].status, 'held');
});

test('the traveller cancels the PIN prompt, then pays on a second try', async () => {
  const b = await heldBooking();
  await pay(b, 'deposit');
  await callback(lastCheckoutId(), { resultCode: 1032 });
  let s = await snapshot(b.bookingId);
  assert.equal(s.payments[0].status, 'cancelled');
  assert.equal(s.booking[0].status, 'held');

  assert.equal((await pay(b, 'deposit', '0733000001')).statusCode, 201, 'retry with another number');
  await callback(lastCheckoutId(), { amount: 7850 });
  s = await snapshot(b.bookingId);
  assert.equal(s.booking[0].status, 'confirmed');
  assert.deepEqual(s.payments.map((p) => p.status), ['cancelled', 'succeeded']);
});

test('two prompts at once are refused', async () => {
  const b = await heldBooking();
  assert.equal((await pay(b, 'deposit')).statusCode, 201);
  const second = await pay(b, 'deposit');
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error, 'payment_in_progress');
});

test('no callback: reconciliation settles it with STK Query, and a late callback adds the receipt', async () => {
  const b = await heldBooking();
  const start = (await pay(b, 'deposit')).json();
  await db.query(`update payments set created_at = now() - interval '2 minutes' where id = $1`, [start.paymentId]);
  assert.ok((await app.services.payments.reconcilePending()) >= 1);
  let s = await snapshot(b.bookingId);
  assert.equal(s.booking[0].status, 'confirmed');
  assert.match(s.payments[0].mpesa_receipt, /^UNKNOWN-/);
  const status = await app.inject({ url: `/v1/payments/${start.paymentId}?token=${b.holdToken}` });
  assert.equal(status.json().receipt, null, 'unknown receipts are not shown');

  await callback(lastCheckoutId(), { amount: 7850, receipt: 'TLATE00001' });
  s = await snapshot(b.bookingId);
  assert.equal(s.payments[0].mpesa_receipt, 'TLATE00001');
  assert.equal(s.ledger[0].n, 2, 'still one ledger transaction');
});

test('money that arrives after the hold ended is recorded for a full refund', async () => {
  const b = await heldBooking({ slug: 'diani-beach-weekend' });
  const start = (await pay(b, 'deposit')).json();
  // 20 minutes pass with the prompt unanswered, and the hold is released.
  await db.query(`update payments set created_at = now() - interval '20 minutes' where id = $1`, [start.paymentId]);
  await db.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [b.bookingId]);
  await db.query('select release_expired_holds()');
  assert.equal((await snapshot(b.bookingId)).booking[0].status, 'expired');

  await callback(lastCheckoutId(), { amount: start.amountKes });
  const s = await snapshot(b.bookingId);
  assert.equal(s.booking[0].status, 'expired', 'rooms already went back on sale');
  assert.equal(s.payments[0].status, 'succeeded');
  assert.equal(s.refunds[0].n, 1);
  assert.match(sms.sent.at(-1).message, /refund it in full/);
});

test('a hold does not expire while its payment prompt is open', async () => {
  const b = await heldBooking();
  await pay(b, 'deposit');
  await db.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [b.bookingId]);
  await db.query('select release_expired_holds()');
  assert.equal((await snapshot(b.bookingId)).booking[0].status, 'held');
});

test('M-PESA limit and trips too close for a deposit', async () => {
  const big = await heldBooking({ slug: 'diani-resort-escape', travellers: 6 });
  const s = (await app.inject({ url: `/v1/bookings/${big.bookingId}?token=${big.holdToken}` })).json();
  assert.equal(s.options.find((o) => o.option === 'full').overLimit, true);
  const res = await pay(big, 'full');
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error, 'amount_over_limit');

  const soon = await heldBooking({ startDay: 5 });
  const options = (await app.inject({ url: `/v1/bookings/${soon.bookingId}?token=${soon.holdToken}` })).json().options;
  assert.deepEqual(options.map((o) => o.option), ['full']);
  assert.equal((await pay(soon, 'deposit')).json().error, 'deposit_not_available');
});

test('after paying as a guest, signing in with the same phone claims the booking', async () => {
  const b = await heldBooking({ phone: '0700000002' });
  await pay(b, 'deposit');
  await callback(lastCheckoutId(), { amount: 7850 });
  const claim = await app.inject({ method: 'POST', url: `/v1/bookings/${b.bookingId}/claim`, payload: { token: b.holdToken }, headers: { authorization: 'Bearer otieno' } });
  assert.deepEqual(claim.json(), { claimed: true });
  const view = await app.inject({ url: `/v1/bookings/${b.bookingId}`, headers: { authorization: 'Bearer otieno' } });
  assert.equal(view.statusCode, 200, 'owner no longer needs the token');
  assert.equal(view.json().claimed, true);
});

test('every ledger transaction balances', async () => {
  const { rows } = await db.query(`select txn_id from ledger_entries group by txn_id having sum(debit_kes) <> sum(credit_kes)`);
  assert.deepEqual(rows, []);
  const total = (await db.query(`select count(distinct txn_id)::int n from ledger_entries where ref_type = 'payment'`)).rows[0].n;
  assert.ok(total >= 8, `payments recorded in the ledger: ${total}`);
});
