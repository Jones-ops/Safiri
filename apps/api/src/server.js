require('./instrument');
const { loadConfig } = require('./config');
const { buildApp } = require('./app');
const { startJobs } = require('./jobs');

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  let boss = null;

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      app.log.info({ signal }, 'shutting down');
      await boss?.stop();
      await app.close();
      process.exit(0);
    });
  }

  await app.listen({ host: config.HOST, port: config.PORT });
  boss = await startJobs({ connectionString: config.DATABASE_URL, log: app.log, services: app.services });
  if (!config.SUPABASE_URL) app.log.warn('SUPABASE_URL is not set: /v1 routes will fail until it is');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
