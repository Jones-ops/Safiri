/**
 * Role guards. Roles live in profiles.roles, which only the API can change (RLS lets users
 * edit their name and settings, never their roles). The guard loads the roles once per request:
 * request.user.roles. requireRole('admin', 'agency') allows any of the given roles.
 */
function createRoleGuard({ db, requireUser }) {
  async function loadRoles(request, reply) {
    const gate = await requireUser(request, reply);
    if (reply.sent) return gate;
    // ::text[] because pg does not decode arrays of custom enums (they arrive as "{a,b}" strings).
    const { rows } = await db.query('select roles::text[] from profiles where user_id = $1', [request.user.id]);
    request.user.roles = rows[0]?.roles || [];
    return undefined;
  }

  return function requireRole(...allowed) {
    return async function (request, reply) {
      await loadRoles(request, reply);
      if (reply.sent) return;
      if (!allowed.some((role) => request.user.roles.includes(role))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    };
  };
}

/**
 * Runs fn(client) in a transaction with the acting user stamped into request.jwt.claims, so
 * the database audit trigger records who made the change even though the API connects as
 * the service role.
 */
async function asUser(db, userId, fn) {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'service_role' })]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createRoleGuard, asUser };
