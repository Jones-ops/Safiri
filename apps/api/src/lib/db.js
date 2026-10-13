/** Direct Postgres pool for money and inventory work (transactions, holds) and jobs. */
const { Pool } = require('pg');

function createDb(connectionString) {
  if (!connectionString) return null;
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  // A dropped idle connection shouldn't crash the API; the pool replaces it.
  pool.on('error', () => {});
  return pool;
}

module.exports = { createDb };
