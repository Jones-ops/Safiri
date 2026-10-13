const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDb } = require('./harness');
const { build } = require('../seed/generate');

let db;
test.before(async () => {
  db = await createDb();
});
test.after(() => db.close());

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

/**
 * Run statements in a transaction and return the error, if any. Commits by default so deferred
 * checks (ledger balance) run; pass { keep: false } to roll back a change that should succeed.
 */
async function attempt(sql, { keep = true } = {}) {
  try {
    await db.exec(`begin; ${sql}; ${keep ? 'commit' : 'rollback'};`);
    return null;
  } catch (err) {
    await db.exec('rollback').catch(() => {});
    return err;
  }
}

test('seed.sql is up to date with seed/data.js', () => {
  const onDisk = fs.readFileSync(path.join(__dirname, '..', 'seed.sql'), 'utf8');
  assert.equal(onDisk, build(), 'run `npm run db:seed` and commit the result');
});

test('every public table has row level security on', async () => {
  const { rows } = await db.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
  assert.deepEqual(rows, []);
});

test('seed matches the plan: 4 destinations, ~20 listings, 8 packages from KES 8,000 to 60,000', async () => {
  assert.equal((await one('select count(*)::int n from destinations')).n, 4);
  const listings = (await one('select count(*)::int n from listings')).n;
  assert.ok(listings >= 18 && listings <= 22, `listings: ${listings}`);
  const pkgs = await db.query(`select slug, from_price_kes from packages where status = 'published'`);
  assert.equal(pkgs.rows.length, 8);
  for (const p of pkgs.rows) {
    assert.ok(p.from_price_kes >= 8000 && p.from_price_kes <= 60000, `${p.slug}: ${p.from_price_kes}`);
  }
  // The plan's worked example.
  assert.equal(pkgs.rows.find((p) => p.slug === 'naivasha-lakeside-weekend').from_price_kes, 15700);
});

test('seed has a booking in every state', async () => {
  const { rows } = await db.query('select distinct status::text from bookings order by 1');
  assert.deepEqual(rows.map((r) => r.status), ['cancelled', 'completed', 'confirmed', 'draft', 'expired', 'fully_paid', 'held']);
});

test('every ledger transaction balances', async () => {
  const { rows } = await db.query(`
    select txn_id from ledger_entries group by txn_id having sum(debit_kes) <> sum(credit_kes)`);
  assert.deepEqual(rows, []);
  const prepay = await one(`
    select sum(credit_kes - debit_kes)::int as balance from ledger_entries where account = 'traveller_prepayments'`);
  const owed = await one(`
    select sum(b.paid_kes)::int as paid from bookings b where b.status in ('confirmed', 'fully_paid')`);
  assert.equal(prepay.balance, owed.paid, 'prepayments held = money paid on upcoming trips');
});

test('an unbalanced ledger transaction is refused at commit', async () => {
  const err = await attempt(`
    insert into ledger_entries (txn_id, account, debit_kes, ref_type)
    values ('00000000-0000-4000-8000-00000000abcd', 'client_funds', 100, 'adjustment')`);
  assert.match(String(err?.message), /does not balance/);
});

test('ledger entries and the audit log are append-only', async () => {
  assert.match(String((await attempt(`update ledger_entries set debit_kes = debit_kes + 1 where debit_kes > 0`))?.message), /append-only/);
  assert.match(String((await attempt(`delete from ledger_entries`))?.message), /append-only/);
  assert.match(String((await attempt(`delete from audit_log`))?.message), /append-only/);
});

test('money changes are written to the audit log', async () => {
  const row = await one(`select count(*)::int n from audit_log where entity = 'payments' and action = 'INSERT'`);
  assert.equal(row.n, (await one('select count(*)::int n from payments')).n);
});

test('availability can never be oversold', async () => {
  const err = await attempt(`
    update availability set units_booked = units_total - units_held + 1
    where listing_id = (select id from listings limit 1) and date = current_date + 5`);
  assert.match(String(err?.message), /availability_not_oversold/);
});

test('seeded hold and bookings are reflected in availability', async () => {
  const held = await one(`
    select a.units_held from availability a join listings l on l.id = a.listing_id
    where l.title = 'Lake-view room, breakfast included' and a.date = current_date + 21`);
  assert.equal(held.units_held, 1);
});

test('bookings only move between allowed states', async () => {
  assert.match(String((await attempt(`update bookings set status = 'confirmed' where ref = 'SAF-EXP1RD'`))?.message), /cannot move from expired/);
  assert.match(String((await attempt(`update bookings set status = 'completed' where ref = 'SAF-H3LD01'`))?.message), /cannot move from held/);
  assert.equal(await attempt(`update bookings set status = 'expired' where ref = 'SAF-H3LD01'`, { keep: false }), null);
});

test('a replayed M-Pesa callback cannot create a second payment', async () => {
  const p = await one(`select booking_id, msisdn, amount_kes, checkout_request_id, mpesa_receipt from payments limit 1`);
  const dupCheckout = await attempt(`
    insert into payments (booking_id, msisdn, amount_kes, checkout_request_id)
    values ('${p.booking_id}', '${p.msisdn}', ${p.amount_kes}, '${p.checkout_request_id}')`);
  assert.match(String(dupCheckout?.message), /duplicate key/);
  const dupReceipt = await attempt(`
    insert into payments (booking_id, msisdn, amount_kes, checkout_request_id, mpesa_receipt, status, confirmed_at)
    values ('${p.booking_id}', '${p.msisdn}', ${p.amount_kes}, 'ws_CO_NEW', '${p.mpesa_receipt}', 'succeeded', now())`);
  assert.match(String(dupReceipt?.message), /duplicate key/);
});

test('a payment is only succeeded with a receipt and a confirmation time', async () => {
  const p = await one(`select booking_id, msisdn from payments limit 1`);
  const err = await attempt(`
    insert into payments (booking_id, msisdn, amount_kes, status) values ('${p.booking_id}', '${p.msisdn}', 100, 'succeeded')`);
  assert.match(String(err?.message), /check constraint/);
});

test('M-Pesa single-payment limit is enforced', async () => {
  const p = await one(`select booking_id, msisdn from payments limit 1`);
  const err = await attempt(`insert into payments (booking_id, msisdn, amount_kes) values ('${p.booking_id}', '${p.msisdn}', 250001)`);
  assert.match(String(err?.message), /check constraint/);
});

test('only completed bookings can be reviewed', async () => {
  const b = await one(`select id, user_id from bookings where ref = 'SAF-C0NF01'`);
  const err = await attempt(`insert into reviews (booking_id, user_id, rating) values ('${b.id}', '${b.user_id}', 5)`);
  assert.match(String(err?.message), /only a completed booking/);
});

test('a phone sign-up creates a profile; bad phone numbers are refused', async () => {
  assert.equal(await attempt(`
    insert into auth.users (id, phone) values ('00000000-0000-4000-8000-00000000f00d', '254799999999');
    do $$ begin
      if not exists (select 1 from profiles where phone = '254799999999') then raise exception 'no profile'; end if;
    end $$`, { keep: false }), null);
  assert.match(String((await attempt(`insert into auth.users (id, phone) values (gen_random_uuid(), '12345')`))?.message), /msisdn/);
});
