/**
 * Route guard: requires "Authorization: Bearer <Supabase access token>".
 * On success, request.user = { id, phone, claims }.
 */
function requireUser(verifyToken) {
  return async function (request, reply) {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const claims = token ? await verifyToken(token).catch(() => null) : null;
    if (!claims) {
      return reply.code(401).send({ error: 'unauthorised', message: 'Sign in again' });
    }
    request.user = { id: claims.sub, phone: claims.phone || null, claims };
  };
}

/**
 * Sign-in is optional (guests can quote and hold), but a token that is sent must be valid.
 * request.user is the user or null.
 */
function optionalUser(verifyToken) {
  return async function (request, reply) {
    request.user = null;
    const header = request.headers.authorization;
    if (!header) return;
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const claims = token ? await verifyToken(token).catch(() => null) : null;
    if (!claims) return reply.code(401).send({ error: 'unauthorised', message: 'Sign in again' });
    request.user = { id: claims.sub, phone: claims.phone || null, claims };
  };
}

module.exports = { requireUser, optionalUser };
