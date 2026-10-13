require('./instrument');
const { loadConfig } = require('./config');
const { buildApp } = require('./app');

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      app.log.info({ signal }, 'shutting down');
      await app.close();
      process.exit(0);
    });
  }

  await app.listen({ host: config.HOST, port: config.PORT });
  if (!config.SUPABASE_URL) app.log.warn('SUPABASE_URL is not set: /v1 routes will fail until it is');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
