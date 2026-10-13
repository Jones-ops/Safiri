/**
 * Quick check: apply every migration and the seed to a throwaway Postgres and print counts.
 * Run with `npm run db:check`.
 */
const { createDb, migrationFiles } = require('./harness');

(async () => {
  const db = await createDb();
  console.log(`Applied ${migrationFiles().length} migrations and seed.sql`);
  const { rows } = await db.query(`
    select 'destinations' as table, count(*)::int as rows from destinations union all
    select 'providers', count(*)::int from providers union all
    select 'listings', count(*)::int from listings union all
    select 'packages', count(*)::int from packages union all
    select 'availability', count(*)::int from availability union all
    select 'bookings', count(*)::int from bookings union all
    select 'payments', count(*)::int from payments union all
    select 'ledger_entries', count(*)::int from ledger_entries`);
  console.table(rows);
  const states = await db.query(`select status, count(*)::int as n from bookings group by status order by status`);
  console.table(states.rows);
  await db.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
