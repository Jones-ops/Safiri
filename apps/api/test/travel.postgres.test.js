/**
 * Slice 4: the itinerary the app saves for offline use (real Postgres, seeded bookings).
 * The airplane-mode part of the done-when is checked on a phone (see the Slice 4 demo script).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { tripReminders } = require('@safiri/shared');
const { startPostgres } = require('../../../supabase/tests/postgres-harness');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');

let pg;
let db;
let app;
const users = {};

test.before(async () => {
  pg = await startPostgres();
  db = new Pool({ connectionString: pg.url, max: 5 });
  for (const [name, phone] of [['wanjiru', '254700000001'], ['otieno', '254700000002']]) {
    users[name] = (await db.query('select user_id from profiles where phone = $1', [phone])).rows[0].user_id;
  }
  const config = loadConfig({ NODE_ENV: 'test', HOLD_TOKEN_SECRET: 'sign', SUPPORT_PHONE: '254711000999' });
  app = await buildApp(config, {
    supabase: null, db, profiles: {}, catalogue: {},
    verifyToken: async (token) => (users[token] ? { sub: users[token] } : null),
  });
});

test.after(async () => {
  await app?.close();
  await db?.end();
  await pg?.stop();
});

const bookingId = async (ref) => (await db.query('select id from bookings where ref = $1', [ref])).rows[0].id;
const itinerary = (id, who) => app.inject({ url: `/v1/bookings/${id}/itinerary`, headers: who ? { authorization: `Bearer ${who}` } : {} });

test('a confirmed trip has a day-by-day itinerary with times, contacts, map area and emergency numbers', async () => {
  const res = await itinerary(await bookingId('SAF-C0NF01'), 'wanjiru'); // Mara budget safari, 2 nights
  assert.equal(res.statusCode, 200, res.body);
  const it = res.json();
  assert.equal(it.ref, 'SAF-C0NF01');
  assert.equal(it.destination.name, 'Maasai Mara');
  assert.equal(it.days.length, 3, 'two nights: three days');
  assert.deepEqual(it.days[2].items, [], 'the day home is shown, with nothing booked');
  assert.equal(it.days[0].date, it.startDate);
  assert.deepEqual(it.days[0].items[0], { time: '06:30', title: 'Nairobi-Mara return by 4x4 safari van', kind: 'transport', provider: 'Mara Road Safaris' });
  const times = it.days[0].items.map((i) => i.time).filter(Boolean);
  assert.deepEqual(times, [...times].sort(), 'each day in time order');

  const roles = it.contacts.map((c) => c.role).sort();
  assert.deepEqual(roles, ['driver', 'guide', 'lodge']);
  assert.ok(it.contacts.every((c) => /^2547\d{8}$/.test(c.phone)), 'phone numbers to call or WhatsApp');

  const [w, s, e, n] = it.mapBounds;
  assert.ok(w < it.destination.lng && it.destination.lng < e && s < it.destination.lat && it.destination.lat < n, 'map covers the destination');
  assert.deepEqual(it.emergency.map((x) => x.phone), ['999', '112', '254711000999']);

  // The phone schedules a reminder an hour before the 06:30 van, in Kenya time.
  const reminders = tripReminders(it, new Date(`${it.startDate}T00:00:00Z`).getTime() - 10 * 86400000);
  assert.equal(reminders.find((r) => r.kind === 'morning_of').at, `${it.startDate}T02:30:00.000Z`);
});

test('only people on the booking see it, and only once it is confirmed', async () => {
  const id = await bookingId('SAF-C0NF01');
  assert.equal((await itinerary(id)).statusCode, 404, 'no sign-in, no token');
  assert.equal((await itinerary(id, 'otieno')).statusCode, 404, "someone else's trip");
  const held = await itinerary(await bookingId('SAF-H3LD01'), 'wanjiru');
  assert.equal(held.statusCode, 409);
  assert.equal(held.json().error, 'not_confirmed', 'provider numbers stay private until the trip is confirmed');
});
