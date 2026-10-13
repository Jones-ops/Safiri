/**
 * Row Level Security: each test runs as a real app role (anon or authenticated with a JWT
 * subject) against the seeded data. Policies are part of the definition of done.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, as, expectError } = require('./harness');

let db;
const users = {};
test.before(async () => {
  db = await createDb();
  const { rows } = await db.query(`select user_id, phone from profiles`);
  const byPhone = Object.fromEntries(rows.map((r) => [r.phone, r.user_id]));
  users.wanjiru = byPhone['254700000001'];
  users.otieno = byPhone['254700000002'];
  users.achieng = byPhone['254700000003'];
  users.agency = byPhone['254700000021'];
  users.ziwaShores = byPhone['254700000101']; // first seeded provider owner
});
test.after(() => db.close());

const count = async (tx, sql) => (await tx.query(sql)).rows.length;

test.describe('anonymous visitor (public web pages, app before sign-in)', () => {
  test('sees the public catalogue', async () => {
    await as(db, null, async (tx) => {
      assert.equal(await count(tx, 'select id from destinations'), 4);
      assert.equal(await count(tx, 'select id from packages'), 8, 'draft package stays hidden');
      assert.equal(await count(tx, 'select id from listings'), 19, 'unverified provider listing stays hidden');
      assert.equal(await count(tx, 'select id, name from providers'), 16);
      assert.ok((await count(tx, 'select id from package_items')) > 0);
      assert.ok((await count(tx, 'select id from availability')) > 0);
    });
  });

  test('sees no bookings, profiles or money', async () => {
    for (const table of ['profiles', 'bookings', 'payments', 'ledger_entries', 'audit_log', 'inventory_holds', 'listing_prices']) {
      const err = await expectError(db, null, (tx) => tx.query(`select * from ${table}`));
      assert.match(String(err?.message), /permission denied/, table);
    }
  });

  test('cannot read private columns', async () => {
    const payout = await expectError(db, null, (tx) => tx.query('select payout_msisdn from providers'));
    assert.match(String(payout?.message), /permission denied/);
    const margin = await expectError(db, null, (tx) => tx.query('select margin_bps from packages'));
    assert.match(String(margin?.message), /permission denied/);
  });
});

test.describe('traveller', () => {
  test('sees only their own bookings', async () => {
    await as(db, users.wanjiru, async (tx) => {
      const { rows } = await tx.query('select ref from bookings order by ref');
      assert.deepEqual(rows.map((r) => r.ref), ['SAF-C0NF01', 'SAF-CANC01', 'SAF-D0NE01', 'SAF-FP4ID1', 'SAF-H3LD01']);
      assert.equal(await count(tx, 'select id from payments'), 7); // 1 + 4 + 1 + 1 across her paid bookings
      assert.equal(await count(tx, 'select id from profiles'), 1);
    });
  });

  test('can edit name, language and data saver, but never roles or phone', async () => {
    await as(db, users.wanjiru, async (tx) => {
      const { affectedRows } = await tx.query(`update profiles set name = 'Wanjiru K', language = 'sw', low_data = true`);
      assert.equal(affectedRows, 1);
    });
    const roles = await expectError(db, users.wanjiru, (tx) => tx.query(`update profiles set roles = '{admin}'`));
    assert.match(String(roles?.message), /permission denied/);
    const phone = await expectError(db, users.wanjiru, (tx) => tx.query(`update profiles set phone = '254711111111'`));
    assert.match(String(phone?.message), /permission denied/);
  });

  test("cannot change another user's profile", async () => {
    await as(db, users.wanjiru, async (tx) => {
      const { affectedRows } = await tx.query(`update profiles set name = 'x' where phone = '254700000002'`);
      assert.equal(affectedRows, 0);
    });
  });

  test('cannot write money or bookings directly (only the API can)', async () => {
    for (const sql of [
      `insert into payments (booking_id, msisdn, amount_kes) select id, phone, 1 from bookings limit 1`,
      `update bookings set paid_kes = total_kes`,
      `insert into ledger_entries (txn_id, account, debit_kes, ref_type) values (gen_random_uuid(), 'client_funds', 1, 'x')`,
      `insert into quotes (start_date, end_date, travellers, items, breakdown, per_person_kes, total_kes)
       values (current_date, current_date, 1, '[]', '{}', 1, 1)`,
    ]) {
      const err = await expectError(db, users.wanjiru, (tx) => tx.query(sql));
      assert.match(String(err?.message), /permission denied/, sql);
    }
  });

  test('does not see provider net prices', async () => {
    const err = await expectError(db, users.wanjiru, (tx) => tx.query('select net_kes from booking_items'));
    assert.match(String(err?.message), /permission denied/);
    await as(db, users.wanjiru, async (tx) => {
      assert.equal(await count(tx, 'select id from listing_prices'), 0);
    });
  });

  test('records consent for themselves only', async () => {
    await as(db, users.wanjiru, async (tx) => {
      await tx.query(`insert into consents (purpose, granted_at) values ('analytics', now())`);
      assert.equal(await count(tx, `select id from consents where purpose = 'analytics'`), 1);
    });
    const err = await expectError(db, users.wanjiru, (tx) =>
      tx.query(`insert into consents (user_id, purpose, granted_at) values ('${users.otieno}', 'analytics', now())`));
    assert.match(String(err?.message), /row-level security/);
  });

  test("cannot review someone else's trip", async () => {
    const { id } = (await db.query(`select id from bookings where ref = 'SAF-D0NE01'`)).rows[0];
    const err = await expectError(db, users.otieno, (tx) =>
      tx.query(`insert into reviews (booking_id, rating) values ($1, 1)`, [id]));
    assert.match(String(err?.message), /only a traveller on this booking/);
  });
});

test.describe('group split', () => {
  test('a member sees the group booking and only their own share', async () => {
    await as(db, users.achieng, async (tx) => {
      const { rows } = await tx.query('select ref from bookings');
      assert.deepEqual(rows.map((r) => r.ref), ['SAF-GR0UP1']);
      assert.equal(await count(tx, 'select id from group_members'), 1);
      assert.equal(await count(tx, 'select id from payments'), 0, "can't see the organiser's payment");
    });
  });

  test('the organiser sees every member', async () => {
    await as(db, users.otieno, async (tx) => {
      assert.equal(await count(tx, 'select id from group_members'), 2);
    });
  });
});

test.describe('provider and agency', () => {
  test('a provider sees bookings with their items, and their own net prices only', async () => {
    await as(db, users.ziwaShores, async (tx) => {
      const { rows } = await tx.query('select distinct booking_id from booking_items');
      assert.ok(rows.length >= 1);
      const listingIds = (await tx.query(`select listing_id from listing_prices`)).rows;
      assert.equal(listingIds.length, 2, 'Ziwa Shores has two listings');
    });
  });

  test('an agency sees its draft package and its bookings', async () => {
    await as(db, users.agency, async (tx) => {
      assert.equal(await count(tx, 'select id from packages'), 9);
      assert.equal(await count(tx, 'select id from bookings'), 8);
    });
  });
});
