/**
 * Slice 6 and account rights, on a real Postgres:
 *   - only travellers with a completed booking can review (and only once)
 *   - a referral discount applies once per new traveller; the referrer is rewarded on confirmation
 *   - a traveller can export everything we hold and delete their account
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { addDays, todayInKenya } = require('@safiri/shared');
const { startPostgres } = require('../../../supabase/tests/postgres-harness');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const SECRET = 'cb-secret';
let pg;
let db;
let app;
const users = {};
const deleted = [];

const daraja = {
  configured: true, pushes: [],
  async stkPush() { const n = this.pushes.push(1); return { merchantRequestId: `mr-${n}`, checkoutRequestId: `ws_CO_CB_${n}`, customerMessage: 'ok' }; },
  async stkQuery() { return { state: 'succeeded', resultCode: 0, resultDesc: 'ok' }; },
};
const sms = { sent: [], async send(to, message) { this.sent.push({ to, message }); return { id: 'x' }; } };
const supabaseAdmin = { auth: { admin: { deleteUser: async (id) => { deleted.push(id); return { error: null }; } } } };

const inDays = (n) => addDays(todayInKenya(), n);

test.before(async () => {
  pg = await startPostgres();
  db = new Pool({ connectionString: pg.url, max: 5 });
  for (const [name, phone] of [['wanjiru', '254700000001'], ['otieno', '254700000002'], ['achieng', '254700000003']]) {
    users[name] = (await db.query('select user_id from profiles where phone = $1', [phone])).rows[0].user_id;
  }
  await db.query(`update profiles set email = 'achieng@safiri.example' where user_id = $1`, [users.achieng]);
  const config = loadConfig({ NODE_ENV: 'test', HOLD_TOKEN_SECRET: 'sign', DARAJA_CALLBACK_SECRET: SECRET });
  app = await buildApp(config, {
    supabase: supabaseAdmin, db, daraja, sms, profiles: {}, catalogue: {},
    verifyToken: async (token) => (users[token] ? { sub: users[token] } : null),
  });
});

test.after(async () => {
  await app?.close();
  await db?.end();
  await pg?.stop();
});

const as = (who) => ({ authorization: `Bearer ${who}` });
const callback = (checkoutRequestId, amount) =>
  app.inject({ method: 'POST', url: `/hooks/mpesa/stk/${SECRET}`, payload: { Body: { stkCallback: {
    MerchantRequestID: 'mr', CheckoutRequestID: checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
    CallbackMetadata: { Item: [{ Name: 'Amount', Value: amount }, { Name: 'MpesaReceiptNumber', Value: `TC${checkoutRequestId.replace(/\D/g, '').padStart(8, '0')}` }] },
  } } } });

test('reviews: only a completed booking, only by its traveller, only once; media must be in the reviewer\'s folder', async () => {
  const confirmed = (await db.query(`select id from bookings where ref = 'SAF-C0NF01'`)).rows[0].id; // Wanjiru's, not completed
  const tooEarly = await app.inject({ method: 'POST', url: '/v1/me/reviews', headers: as('wanjiru'), payload: { bookingId: confirmed, rating: 5 } });
  assert.equal(tooEarly.statusCode, 409);
  assert.equal(tooEarly.json().error, 'not_reviewable');

  // Wanjiru's fully paid Amboseli trip ends: the daily job completes it, and reviews open.
  const amboseli = (await db.query(`select id from bookings where ref = 'SAF-FP4ID1'`)).rows[0].id;
  await db.query(`update bookings set start_date = current_date - 4, end_date = current_date - 2 where id = $1`, [amboseli]);
  assert.equal(await app.services.settlement.completeEndedTrips({ today: todayInKenya() }), 1);

  const someoneElse = await app.inject({ method: 'POST', url: '/v1/me/reviews', headers: as('otieno'), payload: { bookingId: amboseli, rating: 5 } });
  assert.equal(someoneElse.statusCode, 409, "not Otieno's trip");
  const badMedia = await app.inject({ method: 'POST', url: '/v1/me/reviews', headers: as('wanjiru'), payload: { bookingId: amboseli, rating: 5, mediaPaths: [`${users.otieno}/x.jpg`] } });
  assert.equal(badMedia.statusCode, 400, "a path in someone else's folder");

  const ok = await app.inject({ method: 'POST', url: '/v1/me/reviews', headers: as('wanjiru'), payload: { bookingId: amboseli, rating: 4, body: 'Kilimanjaro was clear at sunrise.', mediaPaths: [`${users.wanjiru}/amboseli-1.jpg`, `${users.wanjiru}/sunrise.mp4`] } });
  assert.equal(ok.statusCode, 201, ok.body);
  const media = await db.query(`select kind::text, upload_status::text from media where review_id = $1 order by path`, [ok.json().reviewId]);
  assert.deepEqual(media.rows, [{ kind: 'photo', upload_status: 'complete' }, { kind: 'clip', upload_status: 'complete' }]);
  const again = await app.inject({ method: 'POST', url: '/v1/me/reviews', headers: as('wanjiru'), payload: { bookingId: amboseli, rating: 1 } });
  assert.equal(again.json().error, 'already_reviewed');
  // It shows on the public package page data (published review with its rating).
  const shown = await db.query(`select rating from reviews where booking_id = $1 and status = 'published'`, [amboseli]);
  assert.equal(shown.rows[0].rating, 4);
});

test('a referral discount applies once per new traveller, and the referrer is rewarded when the trip confirms', async () => {
  const mine = await app.inject({ url: '/v1/me/referral', headers: as('wanjiru') });
  assert.equal(mine.statusCode, 200, mine.body);
  const { code, discountKes } = mine.json();
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal(discountKes, 500);
  assert.equal((await app.inject({ url: '/v1/me/referral', headers: as('wanjiru') })).json().code, code, 'the same code each time');

  const quoteBody = { packageSlug: 'naivasha-day-escape', startDate: inDays(20), travellers: 2, referralCode: code.toLowerCase() };
  // Wanjiru cannot use her own code; a guest (no account) cannot use one either.
  assert.equal((await app.inject({ method: 'POST', url: '/v1/quotes', headers: as('wanjiru'), payload: quoteBody })).json().discountKes, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/quotes', payload: quoteBody })).json().referralApplied, false);
  // Otieno has booked before (seed): not a new traveller.
  assert.equal((await app.inject({ method: 'POST', url: '/v1/quotes', headers: as('otieno'), payload: quoteBody })).json().discountKes, 0);

  // Achieng is new: KES 500 off, recorded once when she holds, rewarded to Wanjiru when she pays.
  const quote = (await app.inject({ method: 'POST', url: '/v1/quotes', headers: as('achieng'), remoteAddress: '10.6.0.1', payload: quoteBody })).json();
  assert.equal(quote.referralApplied, true);
  assert.equal(quote.discountKes, 500);
  assert.equal(quote.totalKes, quote.perPersonKes * 2 - 500);
  const hold = (await app.inject({ method: 'POST', url: '/v1/holds', headers: as('achieng'), remoteAddress: '10.6.0.1', payload: { quoteId: quote.id, phone: '0700000003' } })).json();
  assert.equal(hold.totalKes, quote.totalKes, 'the hold charges the discounted total');
  const redeemed = await db.query('select booking_id from referral_redemptions where user_id = $1', [users.achieng]);
  assert.equal(redeemed.rows[0].booking_id, hold.bookingId);
  const booking = await db.query('select discount_kes, total_kes from bookings where id = $1', [hold.bookingId]);
  assert.equal(booking.rows[0].discount_kes, 500);

  // A second discounted quote for Achieng is refused: once per new traveller.
  assert.equal((await app.inject({ method: 'POST', url: '/v1/quotes', headers: as('achieng'), remoteAddress: '10.6.0.1', payload: { ...quoteBody, startDate: inDays(30) } })).json().discountKes, 0);

  const pay = (await app.inject({ method: 'POST', url: '/v1/payments', headers: as('achieng'), remoteAddress: '10.6.0.1', payload: { bookingId: hold.bookingId, option: 'full', phone: '0700000003' } })).json();
  assert.equal(pay.amountKes, quote.totalKes);
  await callback(`ws_CO_CB_${daraja.pushes.length}`, pay.amountKes);
  const after = (await app.inject({ url: '/v1/me/referral', headers: as('wanjiru') })).json();
  assert.equal(after.usesLeft, 9);
  assert.equal(after.rewards.length, 1, 'Wanjiru earned a one-use code');
  assert.equal(after.rewards[0].discountKes, 500);
});

test('a traveller can export everything we hold, then delete the account; booking records stay without the person', async () => {
  const exported = await app.inject({ url: '/v1/me/export', headers: as('achieng') });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.headers['content-disposition'], /safiri-my-data\.json/);
  const data = exported.json();
  assert.equal(data.profile.email, 'achieng@safiri.example');
  assert.equal(data.bookings.length, 1);
  assert.equal(data.payments.length, 1);
  assert.ok(Array.isArray(data.consents) && Array.isArray(data.notifications));

  const del = await app.inject({ method: 'DELETE', url: '/v1/me', headers: as('achieng') });
  assert.equal(del.statusCode, 204);
  assert.deepEqual(deleted, [users.achieng], 'the sign-in itself is deleted');
  const profile = (await db.query('select email, name, phone, roles::text[] from profiles where user_id = $1', [users.achieng])).rows[0];
  assert.deepEqual(profile, { email: null, name: null, phone: null, roles: ['traveller'] });
  const booking = (await db.query(`select user_id, phone, status from bookings where phone = '254700000003' order by created_at desc limit 1`)).rows[0];
  assert.equal(booking.user_id, null, 'no longer linked to a person');
  assert.equal(booking.phone, '254700000003', 'the payment record keeps the M-PESA number, as the privacy notice says');
  assert.equal((await db.query('select count(*)::int c from consents where user_id = $1', [users.achieng])).rows[0].c, 0);
});
