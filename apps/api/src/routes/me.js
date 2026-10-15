/** The signed-in user. Proves the app-to-API auth path that every money route will use. */
async function meRoutes(app, { requireUser, profiles }) {
  app.get('/v1/me', { preHandler: requireUser }, async (request, reply) => {
    const profile = await profiles.getByUserId(request.user.id);
    if (!profile) return reply.code(404).send({ error: 'not_found', message: 'No profile for this user' });
    return {
      id: profile.user_id,
      email: profile.email,
      phone: profile.phone,
      name: profile.name,
      roles: profile.roles,
      language: profile.language,
      lowData: profile.low_data,
    };
  });
}

module.exports = meRoutes;
