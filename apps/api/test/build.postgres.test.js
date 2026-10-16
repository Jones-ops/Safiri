/**
 * Quotes and holds through the API, on a real Postgres with the seed loaded.
 * Slice 2 done-when covered here: "the app's price always equals the server quote" (the app
 * only ever shows the quote's numbers; these tests pin the quote to the one pricing rule and
 * the display price to the quote) and "expired holds release" (also in supabase/tests).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { addDays, priceBreakdown, todayInKenya, DEFAULTS } = require('@safiri/shared');
const { startPostgres } = require('../../../supabase/tests/postgres-harness');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { startJobs } = require('../src/jobs');

let pg;
let db;
let app;
let wanjiruId;

const inDays = (n) => addDays(todayInKenya(), n);

test.before(async () => {
  pg = await startPostgres();
  db = new Pool({ connectionString: pg.url, max: 10 });
  wanjiruId = (await db.query(`select user_id from profiles where phone = '254700000001'`)).rows[0].user_id;
  const config = loadConfig({ NODE_ENV: 'test', HOLD_TOKEN_SECRET: 'test-secret' });
  app = await buildApp(config, {
    supabase: null,
    db,
    verifyToken: async (token) => (token === 'wanjiru' ? { sub: wanjiruId, phone: '254700000001' } : null),
    profiles: {},
    catalogue: {},
  });
});

test.after(async () => {
  await app?.close();
  await db?.end();
  await pg?.stop();
});

const quote = (body, headers = {}) => app.inject({ method: 'POST', url: '/v1/quotes', payload: body, headers });
const hold = (body, headers = {}) => app.inject({ method: 'POST', url: '/v1/holds', payload: body, headers });
const listingId = async (title) => (await db.query('select id from listings where title = $1', [title])).rows[0].id;

test('a package quote matches the plan example and hides provider nets and margins', async () => {
  const res = await quote({ packageSlug: 'naivasha-lakeside-weekend', startDate: inDays(14), travellers: 2 });
  assert.equal(res.statusCode, 201, res.body);
  const q = res.json();
  assert.equal(q.perPersonKes, 15700);
  assert.equal(q.totalKes, 31400);
  assert.deepEqual(q.instalments, { times: 4, amountKes: 7850, schedule: [7850, 7850, 7850, 7850] });
  assert.deepEqual(q.perPersonInstalments, { times: 4, amountKes: 3925 }, 'the PriceTag line: or 4 x 3,925');
  assert.equal(q.nights, 2);
  assert.equal(q.endDate, inDays(16));
  assert.equal(q.lines.length, 4, 'shuttle, two nights, boat ride');
  assert.equal(q.available, true);
  assert.equal(q.driveTimeWarning, false);
  assert.ok(!/net|margin|fee/i.test(Object.keys(q).join() + JSON.stringify(q.lines)), 'no business numbers sent to the app');

  // The stored quote keeps the full breakdown, and the parts add up.
  const { rows } = await db.query('select items, breakdown, per_person_kes, total_kes, expires_at > now() as live from quotes where id = $1', [q.id]);
  const stored = rows[0];
  const pp = stored.breakdown.perPerson;
  assert.equal(pp.netKes + pp.marginKes + pp.feeKes, pp.totalKes);
  assert.equal(stored.items.reduce((s, i) => s + i.net_kes, 0), 13000 * 2, 'providers receive their net for two people');
  assert.ok(stored.live);
});

test("every package's display price equals what a quote charges", async () => {
  await app.services.quotes.refreshFromPrices();
  const { rows } = await db.query(`select slug, from_price_kes from packages where status = 'published'`);
  assert.equal(rows.length, 8);
  for (const p of rows) {
    const res = await quote({ packageSlug: p.slug, startDate: inDays(14), travellers: 2 });
    assert.equal(res.statusCode, 201, `${p.slug}: ${res.body}`);
    assert.equal(res.json().perPersonKes, p.from_price_kes, p.slug);
  }
});

test('custom trip: rooms are twin share, and the price follows the shared rule', async () => {
  const lodge = await listingId('Lake-view room, breakfast included');
  const boat = await listingId('Boat ride to Crescent Island');
  const res = await quote({
    destinationSlug: 'naivasha', nights: 1, startDate: inDays(20), travellers: 3,
    items: [{ listingId: lodge, day: 1, qty: 1 }, { listingId: boat, day: 2, qty: 1 }],
  });
  assert.equal(res.statusCode, 201, res.body);
  const q = res.json();
  const expected = priceBreakdown({
    items: [{ netKes: 4500, qty: 1 }, { netKes: 1500, qty: 1 }],
    marginBps: DEFAULTS.AGENCY_MARGIN_BPS,
    feeBps: DEFAULTS.PLATFORM_FEE_BPS,
  }).totalKes;
  assert.equal(q.perPersonKes, expected);
  assert.equal(q.totalKes, expected * 3);
  assert.equal(q.lines.find((l) => l.listingId === lodge).units, 2, 'three travellers need two rooms');
  assert.equal(q.lines.find((l) => l.listingId === boat).date, inDays(21));
});

test('a later season overrides the base price on the dates it covers', async () => {
  const lodge = await listingId('Lake-view room, breakfast included');
  const peak = inDays(30);
  await db.query(`insert into listing_prices (listing_id, season_start, season_end, net_kes) values ($1, $2, $2, 6500)`, [lodge, peak]);
  const res = await quote({ destinationSlug: 'naivasha', nights: 2, startDate: inDays(29), travellers: 2, items: [{ listingId: lodge, day: 1, qty: 2 }] });
  const expected = priceBreakdown({ items: [{ netKes: 4500, qty: 1 }, { netKes: 6500, qty: 1 }], marginBps: 1500, feeBps: 500 }).totalKes;
  assert.equal(res.json().perPersonKes, expected);
});

test('the long drive to the Mara on a short trip gets a warning', async () => {
  const camp = await listingId('Budget tent, full board');
  const res = await quote({ destinationSlug: 'maasai-mara', nights: 1, startDate: inDays(25), travellers: 2, items: [{ listingId: camp, day: 1, qty: 1 }] });
  assert.equal(res.json().driveTimeWarning, true);
});

test('bad requests are refused with a reason', async () => {
  const lodge = await listingId('Lake-view room, breakfast included');
  const diani = await listingId('Garden cottage, 3 minutes from the beach');
  const cases = [
    [{ packageSlug: 'naivasha-lakeside-weekend', startDate: todayInKenya(), travellers: 2 }, 422, 'date_out_of_range'],
    [{ packageSlug: 'naivasha-lakeside-weekend', startDate: inDays(400), travellers: 2 }, 422, 'date_out_of_range'],
    [{ packageSlug: 'no-such-trip', startDate: inDays(10), travellers: 2 }, 404, 'package_not_found'],
    [{ packageSlug: 'naivasha-flamingo-weekend', startDate: inDays(10), travellers: 2 }, 404, 'package_not_found'],
    [{ packageSlug: 'naivasha-lakeside-weekend', startDate: inDays(10), travellers: 2, totalKes: 1 }, 400, 'invalid_request'],
    [{ destinationSlug: 'naivasha', nights: 1, startDate: inDays(10), travellers: 2, items: [{ listingId: diani, day: 1, qty: 1 }] }, 422, 'invalid_items'],
    [{ destinationSlug: 'naivasha', nights: 0, startDate: inDays(10), travellers: 2, items: [{ listingId: lodge, day: 1, qty: 1 }] }, 422, 'stay_needs_nights'],
    [{ destinationSlug: 'naivasha', nights: 1, startDate: inDays(10), travellers: 2, items: [{ listingId: lodge, day: 1, qty: 3 }] }, 422, 'item_outside_trip'],
  ];
  for (const [body, status, error] of cases) {
    const res = await quote(body);
    assert.equal(res.statusCode, status, JSON.stringify(body));
    assert.equal(res.json().error, error, JSON.stringify(body));
  }
});

test('hold lifecycle: hold, view with the token, release, rooms come back', async () => {
  const q = (await quote({ packageSlug: 'amboseli-kilimanjaro-weekend', startDate: inDays(35), travellers: 2 })).json();
  const room = await listingId('Lodge room, full board');
  const freeBefore = (await db.query(`select units_total - units_held - units_booked as f from availability where listing_id = $1 and date = $2`, [room, inDays(35)])).rows[0].f;

  const res = await hold({ quoteId: q.id, phone: '0711 222 333' });
  assert.equal(res.statusCode, 201, res.body);
  const h = res.json();
  assert.match(h.ref, /^SAF-[A-Z2-9]{6}$/);
  assert.equal(h.totalKes, q.totalKes, 'the hold charges exactly the quote');
  const minutes = (new Date(h.holdExpiresAt) - Date.now()) / 60000;
  assert.ok(minutes > 14 && minutes <= 15, `hold lasts 15 minutes (${minutes})`);

  const freeDuring = (await db.query(`select units_total - units_held - units_booked as f from availability where listing_id = $1 and date = $2`, [room, inDays(35)])).rows[0].f;
  assert.equal(freeDuring, freeBefore - 1);

  assert.equal((await app.inject({ url: `/v1/holds/${h.bookingId}` })).statusCode, 404, 'no token: not found');
  assert.equal((await app.inject({ url: `/v1/holds/${h.bookingId}?token=wrong` })).statusCode, 404);
  const view = await app.inject({ url: `/v1/holds/${h.bookingId}?token=${h.holdToken}` });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().status, 'held');
  assert.equal(view.json().title, 'Amboseli weekend under Kilimanjaro');

  const del = await app.inject({ method: 'DELETE', url: `/v1/holds/${h.bookingId}?token=${h.holdToken}` });
  assert.deepEqual(del.json(), { released: true, status: 'cancelled' });
  const freeAfter = (await db.query(`select units_total - units_held - units_booked as f from availability where listing_id = $1 and date = $2`, [room, inDays(35)])).rows[0].f;
  assert.equal(freeAfter, freeBefore);
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/holds/${h.bookingId}?token=${h.holdToken}` })).statusCode, 409);
});

test('a signed-in traveller owns the hold without a token', async () => {
  const q = (await quote({ packageSlug: 'naivasha-day-escape', startDate: inDays(12), travellers: 2 }, { authorization: 'Bearer wanjiru' })).json();
  const h = (await hold({ quoteId: q.id, phone: '0700000001' }, { authorization: 'Bearer wanjiru' })).json();
  const view = await app.inject({ url: `/v1/holds/${h.bookingId}`, headers: { authorization: 'Bearer wanjiru' } });
  assert.equal(view.statusCode, 200);
  const owner = await db.query('select user_id from bookings where id = $1', [h.bookingId]);
  assert.equal(owner.rows[0].user_id, wanjiruId);
  assert.equal((await quote({ packageSlug: 'naivasha-day-escape', startDate: inDays(12), travellers: 2 }, { authorization: 'Bearer forged' })).statusCode, 401);
});

test('sold out, expired quotes and too many holds are refused', async () => {
  const room = await listingId('Tented camp, full board');
  const start = inDays(45);
  await db.query(
    `update availability set units_total = units_held + units_booked where listing_id = $1 and date between $2 and $3`,
    [room, start, inDays(47)],
  );
  const full = (await quote({ packageSlug: 'maasai-mara-tented-safari', startDate: start, travellers: 2 })).json();
  assert.equal(full.available, false);
  assert.ok(full.unavailable.some((u) => u.listingId === room));
  const soldOut = await hold({ quoteId: full.id, phone: '0711000001' });
  assert.equal(soldOut.statusCode, 409);
  assert.equal(soldOut.json().error, 'sold_out');

  const q = (await quote({ packageSlug: 'diani-beach-weekend', startDate: inDays(40), travellers: 2 })).json();
  await db.query(`update quotes set expires_at = now() - interval '1 second' where id = $1`, [q.id]);
  assert.equal((await hold({ quoteId: q.id, phone: '0711000002' })).statusCode, 410);

  const phone = '0711000003';
  for (let i = 0; i < 3; i++) {
    const qi = (await quote({ packageSlug: 'diani-beach-weekend', startDate: inDays(50 + i), travellers: 2 })).json();
    assert.equal((await hold({ quoteId: qi.id, phone })).statusCode, 201);
  }
  const fourth = (await quote({ packageSlug: 'diani-beach-weekend', startDate: inDays(60), travellers: 2 })).json();
  assert.equal((await hold({ quoteId: fourth.id, phone })).json().error, 'too_many_holds');
});

test('display prices follow price changes', async () => {
  const shuttle = await listingId('Nairobi-Naivasha return shuttle');
  await db.query(`update listing_prices set net_kes = 3000 where listing_id = $1`, [shuttle]);
  const changed = await app.services.quotes.refreshFromPrices();
  assert.ok(changed >= 3, 'every Naivasha package with the shuttle is repriced');
  const { rows } = await db.query(`select from_price_kes from packages where slug = 'naivasha-day-escape'`);
  const res = await quote({ packageSlug: 'naivasha-day-escape', startDate: inDays(14), travellers: 2 });
  assert.equal(res.json().perPersonKes, rows[0].from_price_kes);
});

test('the job queue starts and schedules its jobs', async () => {
  const log = { info() {}, warn() {}, error() {} };
  const boss = await startJobs({ connectionString: pg.url, log, services: app.services });
  try {
    const { rows } = await db.query(`select name from pgboss.schedule order by name`);
    assert.deepEqual(rows.map((r) => r.name), [
      'complete-trips', 'expire-provider-requests', 'instalment-plans', 'provider-payouts', 'reconcile-payments', 'refresh-from-prices', 'refunds', 'release-expired-holds',
    ]);
  } finally {
    await boss.stop({ graceful: false, wait: true });
  }
});
