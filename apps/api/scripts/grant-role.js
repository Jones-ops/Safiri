/**
 * Gives an account a role from the command line (the only way to create the first admin).
 *
 *   npm run roles:grant --workspace @safiri/api -- you@example.com admin
 *   npm run roles:grant --workspace @safiri/api -- agent@example.com agency traveller
 *
 * The account must have signed in once (so its profile exists). Needs DATABASE_URL in apps/api/.env.
 */
const { Pool } = require('pg');
const { rolesSchema } = require('@safiri/shared');
const { loadConfig } = require('../src/config');

async function main() {
  const [email, ...roles] = process.argv.slice(2);
  const parsed = rolesSchema.safeParse(roles);
  if (!email || !email.includes('@') || !parsed.success) {
    throw new Error('Usage: grant-role <email> <role...>   roles: traveller provider agency admin');
  }
  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error('Set DATABASE_URL in apps/api/.env');
  const db = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
  try {
    const { rows } = await db.query('update profiles set roles = $2::user_role[] where email = lower($1) returning email, roles::text[]', [email, parsed.data]);
    if (!rows[0]) throw new Error(`No account with email ${email}. Sign in on the app once first.`);
    console.log(`${rows[0].email} now has roles: ${rows[0].roles.join(', ')}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
