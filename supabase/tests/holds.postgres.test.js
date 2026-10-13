/**
 * Slice 2 done-when, on a real Postgres with real concurrent connections:
 *   - 20 parallel hold requests for the last room create exactly one hold
 *   - expired holds release their inventory
 * plus: no deadlocks when trips lock the same rooms in different orders.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, Pool } = require('pg');
const { startPostgres } = require('./postgres-harness');

let pg;
let pool;

test.before(async () => {
  pg = await startPostgres();
  pool = new Pool({ connectionString: pg.url, max: 25 });
});
test.after(async () => {
  await pool?.end();
  await pg?.stop();
});

/** A server-style quote (as the API writes it) for some units of listings on dates. */
async function makeQuote(lines, { expiresIn = '15 minutes' } = {}) {
  const items = [];
  for (const { title, date, units } of lines) {
    const { rows } = await pool.query(`select id, provider_id from listings where title = $1`, [title]);
    items.push({ listing_id: rows[0].id, provider_id: rows[0].provider_id, date, units, net_kes: 1000 * units });
  }
  const { rows } = await pool.query(
    `insert into quotes (start_date, end_date, travellers, items, breakdown, per_person_kes, total_kes, expires_at, destination_id)
     values ($1, $2, 2, $3, '{}', 5000, 10000, now() + $4::interval, (select id from destinations where slug = 'naivasha'))
     returning id`,
    [lines.map((l) => l.date).sort()[0], lines.map((l) => l.date).sort().at(-1), JSON.stringify(items), expiresIn],
  );
  return rows[0].id;
}

async function setRoomsLeft(title, date, left) {
  await pool.query(
    `update availability a set units_total = a.units_held + a.units_booked + $3
     from listings l where l.id = a.listing_id and l.title = $1 and a.date = $2`,
    [title, date, left],
  );
}

async function free(title, date) {
  const { rows } = await pool.query(
    `select a.units_total - a.units_held - a.units_booked as free, a.units_held
     from availability a join listings l on l.id = a.listing_id where l.title = $1 and a.date = $2`,
    [title, date],
  );
  return rows[0];
}

const day = async (n) => (await pool.query(`select (current_date + $1::int)::text as d`, [n])).rows[0].d;
const phone = (i) => `2547${String(10000000 + i).padStart(8, '0')}`;

test('20 parallel hold requests for the last room create exactly one hold', async () => {
  const room = 'Lake-view room, breakfast included';
  const date = await day(40);
  await setRoomsLeft(room, date, 1);
  const quotes = [];
  for (let i = 0; i < 20; i++) quotes.push(await makeQuote([{ title: room, date, units: 1 }]));

  // 20 separate connections, released at the same moment.
  const clients = await Promise.all(quotes.map(async () => {
    const c = new Client({ connectionString: pg.url });
    await c.connect();
    return c;
  }));
  let start;
  const gate = new Promise((resolve) => { start = resolve; });
  const attempts = clients.map((c, i) => gate.then(() => c.query('select * from place_hold($1, $2)', [quotes[i], phone(i)])));
  start();
  const results = await Promise.allSettled(attempts);
  await Promise.all(clients.map((c) => c.end()));

  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1, 'exactly one hold');
  assert.equal(lost.length, 19);
  for (const r of lost) assert.equal(r.reason.message, 'sold_out');

  const after = await free(room, date);
  assert.equal(after.free, 0);
  const { rows } = await pool.query(`select count(*)::int n from bookings where quote_id = any($1) and status = 'held'`, [quotes]);
  assert.equal(rows[0].n, 1);
  assert.match(won[0].value.rows[0].ref, /^SAF-[A-Z2-9]{6}$/);
});

test('trips that lock the same rooms in opposite order never deadlock', async () => {
  const a = 'Lake-view room, breakfast included';
  const b = 'Furnished tent with bedding';
  const d1 = await day(50);
  const d2 = await day(51);
  await setRoomsLeft(a, d1, 100);
  await setRoomsLeft(b, d2, 100);
  const forward = [];
  const backward = [];
  for (let i = 0; i < 10; i++) {
    forward.push(await makeQuote([{ title: a, date: d1, units: 1 }, { title: b, date: d2, units: 1 }]));
    backward.push(await makeQuote([{ title: b, date: d2, units: 1 }, { title: a, date: d1, units: 1 }]));
  }
  const all = [...forward, ...backward];
  const results = await Promise.allSettled(all.map((q, i) => pool.query('select * from place_hold($1, $2)', [q, phone(100 + i)])));
  const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  assert.deepEqual(failures, [], 'no deadlock or other errors');
  assert.equal((await free(a, d1)).units_held, 20);
});

test('a quote can be held once, even when submitted twice at the same time', async () => {
  const room = 'Garden cottage, 3 minutes from the beach';
  const date = await day(60);
  await setRoomsLeft(room, date, 5);
  const quote = await makeQuote([{ title: room, date, units: 1 }]);
  const results = await Promise.allSettled([
    pool.query('select * from place_hold($1, $2)', [quote, phone(200)]),
    pool.query('select * from place_hold($1, $2)', [quote, phone(200)]),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.message, 'quote_used');
  assert.equal((await free(room, date)).free, 4);
});

test('expired holds release their rooms and the booking becomes expired', async () => {
  const room = 'Budget tent, full board';
  const date = await day(70);
  await setRoomsLeft(room, date, 1);
  const quote = await makeQuote([{ title: room, date, units: 1 }]);
  const { rows } = await pool.query('select * from place_hold($1, $2)', [quote, phone(300)]);
  assert.equal((await free(room, date)).free, 0);

  // 16 minutes later...
  await pool.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [rows[0].booking_id]);
  const released = await pool.query('select release_expired_holds() as n');
  assert.ok(released.rows[0].n >= 1);
  assert.equal((await free(room, date)).free, 1, 'room is back on sale');
  const b = await pool.query('select status from bookings where id = $1', [rows[0].booking_id]);
  assert.equal(b.rows[0].status, 'expired');
  const h = await pool.query('select released_at from inventory_holds where booking_id = $1', [rows[0].booking_id]);
  assert.ok(h.rows.every((r) => r.released_at));

  // And someone else can now take it.
  const again = await makeQuote([{ title: room, date, units: 1 }]);
  await pool.query('select * from place_hold($1, $2)', [again, phone(301)]);
  assert.equal((await free(room, date)).free, 0);
});

test('an expired quote cannot be held, and app roles cannot call place_hold', async () => {
  const quote = await makeQuote([{ title: 'Lake-view room, breakfast included', date: await day(80), units: 1 }], { expiresIn: '-1 minute' });
  await assert.rejects(pool.query('select * from place_hold($1, $2)', [quote, phone(400)]), /quote_expired/);

  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await assert.rejects(c.query('select * from place_hold($1, $2)', [quote, phone(401)]), /permission denied/);
    await c.query('rollback');
  } finally {
    c.release();
  }
});
