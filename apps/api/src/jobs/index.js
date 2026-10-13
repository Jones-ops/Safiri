/**
 * Background jobs on pg-boss (a Postgres-backed queue, so no extra infrastructure).
 *   release-expired-holds  every minute: give back rooms from holds past their 15 minutes
 *   refresh-from-prices    every hour: keep display prices equal to what a quote charges
 * Later slices add reminders, reconciliation and payouts here.
 */
const JOBS = [
  { name: 'release-expired-holds', cron: '* * * * *', run: ({ holds }) => holds.releaseExpired() },
  { name: 'refresh-from-prices', cron: '7 * * * *', run: ({ quotes }) => quotes.refreshFromPrices() },
];

async function startJobs({ connectionString, log, services }) {
  if (!connectionString) {
    log.warn('DATABASE_URL is not set: background jobs are off (holds still release when a new hold is placed)');
    return null;
  }
  const { PgBoss } = require('pg-boss');
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (err) => log.error({ err }, 'pg-boss error'));
  await boss.start();

  for (const job of JOBS) {
    await boss.createQueue(job.name);
    await boss.schedule(job.name, job.cron, null, { tz: 'Africa/Nairobi' });
    await boss.work(job.name, async () => {
      const result = await job.run(services);
      log.info({ job: job.name, result }, 'job done');
      return result;
    });
  }
  // Run the price refresh once at start-up so a fresh deploy shows current prices.
  await boss.send('refresh-from-prices');
  return boss;
}

module.exports = { startJobs, JOBS };
