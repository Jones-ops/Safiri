/**
 * Runs the real migrations and seed in PGlite (Postgres compiled to WebAssembly), so the
 * schema, constraints and RLS policies are tested in CI without Docker or a Supabase project.
 *
 * PGlite has no Supabase, so supabase-stub.sql provides the small part of Supabase the
 * migrations rely on: the auth schema, auth.uid() and the anon / authenticated / service_role roles.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SUPABASE_DIR = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, 'migrations');

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

async function createDb({ seed = true } = {}) {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase-stub.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (err) {
      err.message = `${file}: ${err.message}`;
      throw err;
    }
  }
  if (seed) {
    try {
      await db.exec(fs.readFileSync(path.join(SUPABASE_DIR, 'seed.sql'), 'utf8'));
    } catch (err) {
      err.message = `seed.sql: ${err.message}`;
      throw err;
    }
  }
  return db;
}

/**
 * Run fn as an app user (role "authenticated" with that user's JWT claims) or as anon
 * when userId is null. Everything is rolled back afterwards.
 */
async function as(db, userId, fn) {
  const role = userId ? 'authenticated' : 'anon';
  const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
  let result;
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await tx.exec(`set local role ${role}`);
    result = await fn(tx);
    await tx.rollback();
  }).catch((err) => {
    // PGlite reports the deliberate rollback as an error; only rethrow real failures.
    if (!/rollback/i.test(String(err && err.message))) throw err;
  });
  return result;
}

/** Like `as`, but returns the error instead of throwing (for "must be refused" checks). */
async function expectError(db, userId, fn) {
  try {
    await as(db, userId, fn);
  } catch (err) {
    return err;
  }
  return null;
}

module.exports = { createDb, as, expectError, migrationFiles };
