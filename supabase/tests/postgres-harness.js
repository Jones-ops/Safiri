/**
 * A real PostgreSQL 17 server (embedded-postgres: real binaries from npm, no Docker) with the
 * migrations and seed applied. Used where PGlite isn't enough: concurrent connections
 * (inventory holds under load) and the API's direct Postgres access. Starting it takes a few
 * seconds on Linux and up to ~30 s on Windows, so share one server per test file.
 */
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const EmbeddedPostgres = require('embedded-postgres').default;
const { migrationFiles } = require('./harness');

const SUPABASE_DIR = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startPostgres({ seed = true } = {}) {
  const port = await freePort();
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safiri-pg-'));
  const server = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('safiri');
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/safiri`;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'supabase-stub.sql'), 'utf8'));
    for (const file of migrationFiles()) {
      try {
        await client.query(fs.readFileSync(path.join(SUPABASE_DIR, 'migrations', file), 'utf8'));
      } catch (err) {
        err.message = `${file}: ${err.message}`;
        throw err;
      }
    }
    if (seed) await client.query(fs.readFileSync(path.join(SUPABASE_DIR, 'seed.sql'), 'utf8'));
  } finally {
    await client.end();
  }

  return {
    url,
    async stop() {
      await server.stop();
      fs.rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startPostgres };
