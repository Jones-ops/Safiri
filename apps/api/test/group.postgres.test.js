/**
 * Slice 3c done-when: "a friend with no app pays their share from a link and the
 * organiser's screen updates within 5 seconds" (real Postgres; Daraja and SMS faked).
 * Also: confirming on the deposit, friends paying at the same time, the organiser covering
 * a friend, guard rails, and organiser reminders.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { addDays, todayInKenya } = require('@safiri/shared');
const { startPostgres } = require('../../../supabase/tests/postgres-harness');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const SECRET = 'callback-secret-group';
const BASE = 'https://safiri.example';
let pg;
let db;
let app;

const daraja = {
  configured: true,
  pushes: [],
  async stkPush(req) {
    const n = this.pushes.push(req);
    return { merchantRequestId: `mr-${n}`, checkoutRequestId: `ws_CO_GRP_${n}`, customerMessage: 'Success. Request accepted for processing' };
  },
  async stkQuery() {
    return { state: 'succeeded', resultCode: 0, resultDesc: 'ok' };
  },
};
const sms = { sent: [], async send(to, message) { this.sent.push({ to, message }); return { id: `sms-${this.sent.length}` }; } };

const today = todayInKenya();
const inDays = (n) => addDays(today, n);
let n = 0;

test.before(async () => {
  pg = await startPostgres();
  db = new Pool({ connectionString: pg.url, max: 10 });
  const config = loadConfig({ NODE_ENV: 'test', HOLD_TOKEN_SECRET: 'sign', DARAJA_CALLBACK_SECRET: SECRET, PUBLIC_BASE_URL: BASE });
  app = await buildApp(config, {
    supabase: null, db, daraja, sms, push: { async send() { return { sent: 0, deadTokens: [] }; } }, whatsapp: { configured: false },
    profiles: {}, catalogue: {}, verifyToken: async () => null,
  });
});

test.after(async () => {
  await app?.close();
  await db?.end();
  await pg?.stop();
});

const callback = (checkoutRequestId, amount) =>
  app.inject({
    method: 'POST',
    url: `/hooks/mpesa/stk/${SECRET}`,
    payload: { Body: { stkCallback: {
      MerchantRequestID: 'mr', CheckoutRequestID: checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
      CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: `TG${checkoutRequestId.replace(/\D/g, '').padStart(8, '0')}` }] },
    } } },
  });
const lastCheckout = () => `ws_CO_GRP_${daraja.pushes.length}`;

/** An organiser (guest) holds a trip for `travellers` people. */
async function heldTrip({ slug = 'diani-resort-escape', travellers = 3, startDay = 50 } = {}) {
  n += 1;
  const ip = `10.7.0.${n}`;
  const phone = `07440${String(n).padStart(5, '0')}`;
  const quote = (await app.inject({ method: 'POST', url: '/v1/quotes', remoteAddress: ip, payload: { packageSlug: slug, startDate: inDays(startDay), travellers } })).json();
  const hold = (await app.inject({ method: 'POST', url: '/v1/holds', remoteAddress: ip, payload: { quoteId: quote.id, phone } })).json();
  return { ...hold, ip, phone };
}

const friendPhone = () => {
  n += 1;
  return `07550${String(n).padStart(5, '0')}`;
};

async function split(trip, friends, shares) {
  return app.inject({
    method: 'POST',
    url: `/v1/bookings/${trip.bookingId}/split`,
    remoteAddress: trip.ip,
    payload: { organiserName: 'Otieno', friends, token: trip.holdToken, ...(shares ? { shares } : {}) },
  });
}

const groupOf = async (trip) => (await app.inject({ url: `/v1/bookings/${trip.bookingId}/group?token=${trip.holdToken}` })).json();
const codeOf = (url) => url.split('/i/')[1];

test('a friend with no app pays their share from a link, and the organiser sees it within 5 seconds', async () => {
  const trip = await heldTrip();
  const holdBefore = new Date(trip.holdExpiresAt);
  const res = await split(trip, [{ name: 'Achieng', phone: friendPhone() }, { name: 'Kamau', phone: friendPhone() }]);
  assert.equal(res.statusCode, 201, res.body);
  const group = res.json();
  assert.equal(group.members.length, 3);
  assert.equal(group.members.reduce((s, m) => s + m.shareKes, 0), group.totalKes, 'shares add up to the total');
  assert.ok(new Date(group.deadline) - holdBefore > 40 * 60 * 1000, 'the hold now lasts about an hour');
  const achieng = group.members.find((m) => m.name === 'Achieng');
  assert.match(achieng.inviteUrl, new RegExp(`^${BASE}/i/[A-Za-z0-9]{12}$`));
  assert.equal(achieng.status, 'not_paid');

  // Achieng opens the link in her phone's browser: no app, no account.
  const code = codeOf(achieng.inviteUrl);
  const page = await app.inject({ url: `/i/${code}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Otieno invited you to Diani resort escape/);
  assert.match(page.body, new RegExp(`Your share: KES ${achieng.shareKes.toLocaleString('en-US')}`));
  const form = await app.inject({ method: 'POST', url: `/i/${code}`, remoteAddress: '10.7.9.1', payload: 'phone=', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.statusCode, 303);
  assert.equal(daraja.pushes.at(-1).amountKes, achieng.shareKes);

  // She enters her PIN; Safaricom calls back. The organiser's screen polls the group status.
  const paidAt = Date.now();
  await callback(lastCheckout(), achieng.shareKes);
  let seenAfter = null;
  while (Date.now() - paidAt < 5000) {
    const now = await groupOf(trip);
    if (now.members.find((m) => m.name === 'Achieng').status === 'paid') {
      seenAfter = Date.now() - paidAt;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(seenAfter !== null && seenAfter < 5000, `organiser saw the payment after ${seenAfter} ms`);

  // A third of the total covers the 25% deposit: the trip is confirmed and the rooms booked.
  const after = await groupOf(trip);
  assert.equal(after.status, 'confirmed');
  assert.equal(after.paidKes, achieng.shareKes);
  assert.match(sms.sent.at(-1).message, /received .* for your share of booking/);
  const status = await app.inject({ url: form.headers.location });
  assert.match(status.body, /Paid\. Thank you!/);
});

test('custom shares: a small first payment keeps the trip held until the deposit is covered', async () => {
  const trip = await heldTrip({ travellers: 2 });
  const total = (await app.inject({ url: `/v1/bookings/${trip.bookingId}?token=${trip.holdToken}` })).json().totalKes;
  const res = await split(trip, [{ name: 'Wambui', phone: friendPhone() }], [total - 5000, 5000]);
  assert.equal(res.statusCode, 201, res.body);
  const wambui = res.json().members.find((m) => !m.isOrganiser);
  await app.inject({ method: 'POST', url: `/v1/invites/${codeOf(wambui.inviteUrl)}/pay`, remoteAddress: '10.7.9.2', payload: {} });
  await callback(lastCheckout(), 5000);
  let g = await groupOf(trip);
  assert.equal(g.status, 'held', 'KES 5,000 is below the 25% deposit');
  assert.equal(g.members.find((m) => !m.isOrganiser).status, 'paid');

  const organiser = g.members.find((m) => m.isOrganiser);
  await app.inject({ method: 'POST', url: `/v1/invites/${codeOf(organiser.inviteUrl)}/pay`, remoteAddress: trip.ip, payload: {} });
  await callback(lastCheckout(), organiser.shareKes);
  g = await groupOf(trip);
  assert.equal(g.status, 'fully_paid');
  assert.equal(g.paidKes, g.totalKes);
});

test('two friends can pay at the same moment; one friend cannot get two prompts', async () => {
  const trip = await heldTrip();
  const g = (await split(trip, [{ name: 'A', phone: friendPhone() }, { name: 'B', phone: friendPhone() }])).json();
  const [a, b] = g.members.filter((m) => !m.isOrganiser).map((m) => codeOf(m.inviteUrl));
  const [ra, rb] = await Promise.all([
    app.inject({ method: 'POST', url: `/v1/invites/${a}/pay`, remoteAddress: '10.7.9.3', payload: {} }),
    app.inject({ method: 'POST', url: `/v1/invites/${b}/pay`, remoteAddress: '10.7.9.4', payload: {} }),
  ]);
  assert.equal(ra.statusCode, 201);
  assert.equal(rb.statusCode, 201);
  const again = await app.inject({ method: 'POST', url: `/v1/invites/${a}/pay`, remoteAddress: '10.7.9.3', payload: {} });
  assert.equal(again.json().error, 'payment_in_progress');
});

test('the organiser covers a friend who does not pay; shares still add up', async () => {
  const trip = await heldTrip();
  const g = (await split(trip, [{ name: 'Paid', phone: friendPhone() }, { name: 'Ghost', phone: friendPhone() }])).json();
  const paid = g.members.find((m) => m.name === 'Paid');
  const ghost = g.members.find((m) => m.name === 'Ghost');
  await app.inject({ method: 'POST', url: `/v1/invites/${codeOf(paid.inviteUrl)}/pay`, remoteAddress: '10.7.9.5', payload: {} });
  await callback(lastCheckout(), paid.shareKes);

  const cover = await app.inject({ method: 'POST', url: `/v1/bookings/${trip.bookingId}/group/${ghost.id}/cover`, remoteAddress: trip.ip, payload: { token: trip.holdToken } });
  assert.equal(cover.statusCode, 200, cover.body);
  assert.equal(cover.json().moved, ghost.shareKes);
  const after = cover.json().group;
  const organiser = after.members.find((m) => m.isOrganiser);
  assert.equal(after.members.find((m) => m.name === 'Ghost').status, 'removed');
  assert.equal(organiser.shareKes, g.members.find((m) => m.isOrganiser).shareKes + ghost.shareKes);
  assert.equal(after.members.reduce((s, m) => s + m.shareKes, 0), after.totalKes);
  // Ghost's link no longer takes money.
  const ghostInvite = (await app.inject({ url: `/v1/invites/${codeOf(ghost.inviteUrl)}` })).json();
  assert.equal(ghostInvite.payable, false);
  assert.equal(ghostInvite.msisdn, undefined, 'the full phone number is never sent to the link');
});

test('guard rails: one split per booking, people and shares must fit, no whole-booking payment', async () => {
  const trip = await heldTrip({ travellers: 2 });
  const tooMany = await split(trip, [{ name: 'A', phone: friendPhone() }, { name: 'B', phone: friendPhone() }]);
  assert.equal(tooMany.json().error, 'too_many_people');
  const wrongSum = await split(trip, [{ name: 'A', phone: friendPhone() }], [1, 1]);
  assert.equal(wrongSum.json().error, 'shares_do_not_add_up');
  const self = await split(trip, [{ name: 'Me again', phone: trip.phone }]);
  assert.equal(self.json().error, 'organiser_is_friend');
  assert.equal((await split(trip, [{ name: 'A', phone: friendPhone() }])).statusCode, 201);
  assert.equal((await split(trip, [{ name: 'A', phone: friendPhone() }])).json().error, 'not_splittable');
  const whole = await app.inject({ method: 'POST', url: '/v1/payments', remoteAddress: trip.ip, payload: { bookingId: trip.bookingId, option: 'full', phone: trip.phone, token: trip.holdToken } });
  assert.equal(whole.json().error, 'not_payable');
  assert.equal((await app.inject({ url: `/v1/bookings/${trip.bookingId}/group` })).statusCode, 404, 'needs the token');
});

test('the organiser is reminded who still owes, 3 days and 1 day before the final due date', async () => {
  const trip = await heldTrip({ startDay: 40 });
  const g = (await split(trip, [{ name: 'Slow', phone: friendPhone() }, { name: 'Fast', phone: friendPhone() }])).json();
  const fast = g.members.find((m) => m.name === 'Fast');
  await app.inject({ method: 'POST', url: `/v1/invites/${codeOf(fast.inviteUrl)}/pay`, remoteAddress: '10.7.9.6', payload: {} });
  await callback(lastCheckout(), fast.shareKes);
  const finalDue = (await db.query('select final_due_date::text as d from payment_plans where booking_id = $1', [trip.bookingId])).rows[0].d;

  const organiserMsisdn = `+254${trip.phone.slice(1)}`;
  const before = sms.sent.filter((s) => s.to === organiserMsisdn).length;
  await app.services.plans.tick({ today: addDays(finalDue, -3) });
  await app.services.plans.tick({ today: addDays(finalDue, -3) }); // twice the same day: still one message
  const msgs = sms.sent.filter((s) => s.to === organiserMsisdn).slice(before);
  assert.equal(msgs.length, 1);
  // Only Slow still owes (the organiser's own share isn't counted as "friends owing").
  assert.match(msgs[0].message, /1 of your group still owe KES [\d,]+ for booking SAF-/);
});

test('every ledger transaction balances', async () => {
  const { rows } = await db.query(`select txn_id from ledger_entries group by txn_id having sum(debit_kes) <> sum(credit_kes)`);
  assert.deepEqual(rows, []);
});
