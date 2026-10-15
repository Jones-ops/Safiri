/**
 * Slice 3b done-when: "a deposit + 3 instalment plan runs end to end on a fast-forwarded
 * clock, including one missed payment" (real Postgres; Daraja, SMS and push faked).
 * Also: a missed final payment cancels the booking per policy, push reminders, and the
 * no-JavaScript web pay page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { addDays, todayInKenya } = require('@safiri/shared');
const { startPostgres } = require('../../../supabase/tests/postgres-harness');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const SECRET = 'callback-secret-plans';
const BASE = 'https://safiri.example';
let pg;
let db;
let app;

const daraja = {
  configured: true,
  pushes: [],
  async stkPush(req) {
    const n = this.pushes.push(req);
    return { merchantRequestId: `mr-${n}`, checkoutRequestId: `ws_CO_PLAN_${n}`, customerMessage: 'Success. Request accepted for processing' };
  },
  async stkQuery() {
    return { state: 'succeeded', resultCode: 0, resultDesc: 'ok' };
  },
};
const sms = { sent: [], async send(to, message) { this.sent.push({ to, message }); return { id: `sms-${this.sent.length}` }; } };
const push = {
  sent: [],
  dead: new Set(),
  async send(m) {
    this.sent.push(m);
    return { sent: m.to.filter((t) => !this.dead.has(t)).length, deadTokens: m.to.filter((t) => this.dead.has(t)) };
  },
};
const whatsapp = { configured: false };

const today = todayInKenya();
const inDays = (n) => addDays(today, n);
let travellerNo = 0;

test.before(async () => {
  pg = await startPostgres();
  db = new Pool({ connectionString: pg.url, max: 10 });
  const config = loadConfig({ NODE_ENV: 'test', HOLD_TOKEN_SECRET: 'sign-secret', DARAJA_CALLBACK_SECRET: SECRET, PUBLIC_BASE_URL: BASE });
  app = await buildApp(config, {
    supabase: null, db, daraja, sms, push, whatsapp, profiles: {}, catalogue: {},
    verifyToken: async (token) => (token.startsWith('user:') ? { sub: token.slice(5), phone: null } : null),
  });
});

test.after(async () => {
  await app?.close();
  await db?.end();
  await pg?.stop();
});

const lastCheckout = () => `ws_CO_PLAN_${daraja.pushes.length}`;
const receiptFor = (id) => `TP${id.replace(/\D/g, '').padStart(8, '0')}`;

function callback(checkoutRequestId, amount) {
  return app.inject({
    method: 'POST',
    url: `/hooks/mpesa/stk/${SECRET}`,
    payload: { Body: { stkCallback: {
      MerchantRequestID: 'mr', CheckoutRequestID: checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
      CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: receiptFor(checkoutRequestId) }] },
    } } },
  });
}

/** Quote, hold and pay the deposit for a 2-person Naivasha weekend starting in `startDay` days. */
async function confirmedBooking(startDay) {
  travellerNo += 1;
  const ip = `10.9.0.${travellerNo}`;
  const phone = `07330${String(travellerNo).padStart(5, '0')}`;
  const quote = (await app.inject({ method: 'POST', url: '/v1/quotes', remoteAddress: ip, payload: { packageSlug: 'naivasha-lakeside-weekend', startDate: inDays(startDay), travellers: 2 } })).json();
  const hold = (await app.inject({ method: 'POST', url: '/v1/holds', remoteAddress: ip, payload: { quoteId: quote.id, phone } })).json();
  const start = await app.inject({ method: 'POST', url: '/v1/payments', remoteAddress: ip, payload: { bookingId: hold.bookingId, option: 'deposit', phone, token: hold.holdToken } });
  assert.equal(start.statusCode, 201, start.body);
  await callback(lastCheckout(), start.json().amountKes);
  return { ...hold, phone: `254${phone.slice(1)}`, ip };
}

const instalments = async (bookingId) =>
  (await db.query(`select id, seq, amount_kes, paid_kes, due_date::text as due, status from instalments where booking_id = $1 order by seq`, [bookingId])).rows;
const booking = async (id) => (await db.query(`select status, paid_kes, total_kes from bookings where id = $1`, [id])).rows[0];
const notices = async (bookingId) =>
  (await db.query(`select kind, channel, status from notifications where booking_id = $1 and kind is not null order by created_at`, [bookingId])).rows;

/** The pay link in the most recent SMS to this phone. */
function lastLinkTo(msisdn) {
  const msg = [...sms.sent].reverse().find((s) => s.to === `+${msisdn}` && s.message.includes('/pay/'));
  return msg?.message.match(/\/pay\/([A-Za-z0-9_.-]+)/)[1];
}

/** Pays the next instalment through a one-tap pay link (as a traveller tapping the SMS would). */
async function payByLink(code, ip) {
  const res = await app.inject({ method: 'POST', url: `/v1/pay-links/${code}/pay`, remoteAddress: ip, payload: {} });
  assert.equal(res.statusCode, 201, res.body);
  await callback(lastCheckout(), res.json().amountKes);
  return res.json();
}

test('a deposit + 3 instalment plan runs end to end on a fast-forwarded clock, with one missed payment', async () => {
  const b = await confirmedBooking(60);
  let plan = await instalments(b.bookingId);
  assert.deepEqual(plan.map((i) => [i.seq, i.status]), [[0, 'paid'], [1, 'due'], [2, 'due'], [3, 'due']]);
  assert.equal(plan[3].due, inDays(53), 'final payment 7 days before travel');
  const [, first, second, third] = plan;

  // Walk the calendar one day at a time from tomorrow to the trip, running the daily job.
  for (let d = 1; d <= 60; d++) {
    const day = inDays(d);
    await app.services.plans.tick({ today: day }); // (also runs every other booking in the database)
    assert.notEqual((await booking(b.bookingId)).status, 'cancelled', `still active on ${day}`);

    if (day === first.due) {
      // Instalment 1: paid on the day, from the reminder's one-tap link.
      const code = lastLinkTo(b.phone);
      const link = (await app.inject({ url: `/v1/pay-links/${code}` })).json();
      assert.equal(link.amountKes, first.amount_kes);
      assert.match(link.phone, /^0733 \*\*\* \d{3}$/, 'phone is masked');
      await payByLink(code, b.ip);
    }
    if (day === addDays(second.due, 3)) {
      // Instalment 2 was MISSED: by now it is overdue and an overdue reminder went out.
      plan = await instalments(b.bookingId);
      assert.equal(plan[2].status, 'overdue');
      await payByLink(lastLinkTo(b.phone), b.ip); // paid late, from the overdue message
    }
    if (day === third.due) {
      // Instalment 3: paid in the app (Trips > Pay next instalment).
      const res = await app.inject({ method: 'POST', url: '/v1/payments', remoteAddress: b.ip, payload: { bookingId: b.bookingId, option: 'instalment', phone: `0${b.phone.slice(3)}`, token: b.holdToken } });
      assert.equal(res.statusCode, 201, res.body);
      assert.equal(res.json().amountKes, third.amount_kes);
      await callback(lastCheckout(), res.json().amountKes);
    }
  }

  plan = await instalments(b.bookingId);
  assert.deepEqual(plan.map((i) => i.status), ['paid', 'paid', 'paid', 'paid']);
  const done = await booking(b.bookingId);
  assert.equal(done.status, 'fully_paid');
  assert.equal(done.paid_kes, done.total_kes);

  // Reminders: 3 days and 1 day before each instalment, plus ONE overdue notice (despite
  // three daily runs while overdue). Guests have no app, so all by SMS.
  const sent = await notices(b.bookingId);
  const count = (kind) => sent.filter((n) => n.kind === kind).length;
  assert.equal(count('reminder_3d'), 3);
  assert.equal(count('reminder_1d'), 3);
  assert.equal(count('overdue'), 1);
  assert.ok(sent.every((n) => n.channel === 'sms' && n.status === 'sent'));
  const overdueText = sms.sent.find((s) => s.to === `+${b.phone}` && s.message.includes('was due'));
  assert.match(overdueText.message, new RegExp(`Pay by \\d+ \\w+ to keep your trip: ${BASE}/pay/`));

  const unbalanced = await db.query(`select txn_id from ledger_entries group by txn_id having sum(debit_kes) <> sum(credit_kes)`);
  assert.deepEqual(unbalanced.rows, []);
});

test('a missed final payment cancels the booking after the grace period, per the policy', async () => {
  const b = await confirmedBooking(45);
  // This package refunds half of what was paid when cancelled close to travel.
  await db.query(`update packages set cancel_policy = '[{"days_before":0,"refund_pct":50}]' where slug = 'naivasha-lakeside-weekend'`);
  const plan = await instalments(b.bookingId);
  const finalDue = plan.at(-1).due;
  const roomsBefore = (await db.query(`select sum(a.units_booked)::int n from availability a join booking_items bi on bi.listing_id = a.listing_id and bi.date = a.date where bi.booking_id = $1`, [b.bookingId])).rows[0].n;

  // Nothing more is paid. Grace is 2 days: still confirmed on the last grace day...
  await app.services.plans.tick({ today: addDays(finalDue, 2) });
  assert.equal((await booking(b.bookingId)).status, 'confirmed');
  // ...cancelled the day after, and the job running again changes nothing.
  const r = await app.services.plans.tick({ today: addDays(finalDue, 3) });
  assert.equal(r.cancelled, 1);
  assert.equal((await app.services.plans.tick({ today: addDays(finalDue, 4) })).cancelled, 0);

  const after = await booking(b.bookingId);
  assert.equal(after.status, 'cancelled');
  const refund = (await db.query(`select amount_kes, status from refunds where booking_id = $1`, [b.bookingId])).rows;
  assert.deepEqual(refund, [{ amount_kes: Math.floor(after.paid_kes / 2), status: 'pending' }]);
  assert.deepEqual((await instalments(b.bookingId)).map((i) => i.status), ['paid', 'cancelled', 'cancelled', 'cancelled']);
  const roomsAfter = (await db.query(`select sum(a.units_booked)::int n from availability a join booking_items bi on bi.listing_id = a.listing_id and bi.date = a.date where bi.booking_id = $1`, [b.bookingId])).rows[0].n;
  assert.ok(roomsAfter < roomsBefore, 'rooms are back on sale');
  assert.match(sms.sent.at(-1).message, /was cancelled because the final payment wasn't made/);

  // A cancelled booking's pay link no longer takes money.
  const link = (await app.inject({ url: `/v1/pay-links/${lastLinkTo(b.phone)}` })).json();
  assert.equal(link.payable, false);
  await db.query(`update packages set cancel_policy = '[{"days_before":30,"refund_pct":100},{"days_before":14,"refund_pct":50},{"days_before":0,"refund_pct":0}]' where slug = 'naivasha-lakeside-weekend'`);
});

test('signed-in travellers get push reminders; dead push tokens are switched off', async () => {
  const b = await confirmedBooking(70);
  const userId = (await db.query(`select user_id from profiles where phone = '254700000003'`)).rows[0].user_id;
  await db.query(`update bookings set user_id = $2 where id = $1`, [b.bookingId, userId]);
  for (const token of ['ExponentPushToken[alive]', 'ExponentPushToken[dead]']) {
    const res = await app.inject({ method: 'POST', url: '/v1/me/push-tokens', headers: { authorization: `Bearer user:${userId}` }, payload: { token, platform: 'android' } });
    assert.equal(res.statusCode, 204);
  }
  push.dead.add('ExponentPushToken[dead]');

  const first = (await instalments(b.bookingId))[1];
  await app.services.plans.tick({ today: addDays(first.due, -3) });
  const pushed = push.sent.at(-1);
  assert.deepEqual(pushed.to.sort(), ['ExponentPushToken[alive]', 'ExponentPushToken[dead]']);
  assert.match(pushed.title, /^Payment due/);
  assert.match(pushed.data.url, /\/pay\//);
  const channels = (await notices(b.bookingId)).filter((n) => n.kind === 'reminder_3d').map((n) => n.channel).sort();
  assert.deepEqual(channels, ['push', 'sms'], 'push, plus SMS while WhatsApp is off');
  const dead = (await db.query(`select disabled_at is not null as off from push_tokens where token = 'ExponentPushToken[dead]'`)).rows[0];
  assert.equal(dead.off, true);

  const trips = await app.inject({ url: '/v1/me/bookings', headers: { authorization: `Bearer user:${userId}` } });
  assert.ok(trips.json().trips.some((t) => t.bookingId === b.bookingId && t.nextPayment));
});

test('the web pay page works without the app or JavaScript', async () => {
  const b = await confirmedBooking(80);
  const first = (await instalments(b.bookingId))[1];
  await app.services.plans.tick({ today: addDays(first.due, -1) });
  const code = lastLinkTo(b.phone);

  const page = await app.inject({ url: `/pay/${code}` });
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers['x-robots-tag'], 'noindex');
  assert.ok(page.body.includes(`Next payment: KES ${first.amount_kes.toLocaleString('en-US')}`));
  assert.ok(page.body.includes(`<form method="post" action="/pay/${code}">`));

  const bad = await app.inject({ method: 'POST', url: `/pay/${code}`, remoteAddress: '10.9.9.1', payload: 'phone=12345', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.body, /Enter a Kenyan mobile number/);

  const sent = await app.inject({ method: 'POST', url: `/pay/${code}`, remoteAddress: '10.9.9.2', payload: 'phone=', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(sent.statusCode, 303);
  assert.equal(daraja.pushes.at(-1).msisdn, b.phone, 'blank phone: the booking phone gets the prompt');
  const statusUrl = sent.headers.location;
  const waiting = await app.inject({ url: statusUrl });
  assert.match(waiting.body, /Check your phone and enter your M-PESA PIN/);
  assert.match(waiting.body, /http-equiv="refresh"/);

  await callback(lastCheckout(), first.amount_kes);
  const paid = await app.inject({ url: statusUrl });
  assert.match(paid.body, /Paid\. Thank you! M-PESA receipt TP/);
  assert.doesNotMatch(paid.body, /http-equiv="refresh"/, 'stops refreshing once settled');

  const tampered = code.slice(0, -1) + (code.at(-1) === 'A' ? 'B' : 'A');
  assert.equal((await app.inject({ url: `/pay/${tampered}` })).statusCode, 404, 'edited links are refused');
});
