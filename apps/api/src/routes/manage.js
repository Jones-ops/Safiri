/**
 * Catalogue management, for admins and agencies (role from profiles.roles):
 *   GET   /v1/manage/me                          my scope: admin?, agencies I own
 *   GET   /v1/manage/destinations                 all destinations (admin may POST/PATCH)
 *   GET   /v1/manage/listings?destinationId=      listings I may package, with today's net price
 *   GET   /v1/manage/packages                     my packages, every status
 *   POST  /v1/manage/packages                     new draft
 *   GET   /v1/manage/packages/:id
 *   PUT   /v1/manage/packages/:id                 edit (items replaced); price refreshed
 *   POST  /v1/manage/packages/:id/publish | /unpublish
 *   GET   /v1/manage/bookings                     bookings on my packages
 * Admin only:
 *   POST  /v1/manage/destinations, PATCH /v1/manage/destinations/:id
 *   GET   /v1/manage/providers, POST /v1/manage/providers/:id/verify { verified }
 *   POST  /v1/manage/agencies { ownerEmail, name, licenceNo }
 *   POST  /v1/manage/agencies/:id/providers/:providerId { status }
 *   POST  /v1/manage/roles { email, roles }
 */
const { destinationInputSchema, packageInputSchema, rolesSchema, z } = require('@safiri/shared');
const { ManageError } = require('../services/manage');
const { UUID } = require('../lib/access');

const invalid = (reply, error) =>
  reply.code(400).send({ error: 'invalid_request', issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

const agencyInputSchema = z.object({ ownerEmail: z.email(), name: z.string().trim().min(1).max(80), licenceNo: z.string().trim().max(40).optional() }).strict();
const rolesInputSchema = z.object({ email: z.email(), roles: rolesSchema }).strict();
const verifySchema = z.object({ verified: z.boolean() }).strict();
const linkSchema = z.object({ status: z.enum(['pending', 'active', 'ended']) }).strict();

async function manageRoutes(app, { manage, requireRole }) {
  const staff = requireRole('admin', 'agency');
  const admin = requireRole('admin');

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ManageError) return reply.code(err.status).send({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'bad_request' });
    request.log.error({ err }, 'manage route failed');
    return reply.code(500).send({ error: 'server_error' });
  });

  // Nothing here is cacheable by anyone in between.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  const idParam = (request, reply) => {
    if (!UUID.test(String(request.params.id))) {
      reply.code(404).send({ error: 'not_found' });
      return null;
    }
    return request.params.id;
  };

  app.get('/v1/manage/me', { preHandler: staff }, async (request) => {
    const scope = await manage.scopeFor(request.user);
    return { userId: request.user.id, roles: request.user.roles, admin: scope.admin, agencies: scope.agencies };
  });

  app.get('/v1/manage/destinations', { preHandler: staff }, async () => ({ destinations: await manage.listDestinations() }));

  app.get('/v1/manage/listings', { preHandler: staff }, async (request, reply) => {
    const { destinationId, agencyId } = request.query;
    if (destinationId && !UUID.test(destinationId)) return reply.code(400).send({ error: 'invalid_request' });
    if (agencyId && !UUID.test(agencyId)) return reply.code(400).send({ error: 'invalid_request' });
    const scope = await manage.scopeFor(request.user);
    if (agencyId && !scope.admin && !scope.agencyIds.includes(agencyId)) return reply.code(403).send({ error: 'forbidden' });
    return { listings: await manage.listListings(scope, { destinationId, agencyId }) };
  });

  app.get('/v1/manage/packages', { preHandler: staff }, async (request) => {
    const scope = await manage.scopeFor(request.user);
    return { packages: await manage.listPackages(scope) };
  });

  app.post('/v1/manage/packages', { preHandler: staff }, async (request, reply) => {
    const parsed = packageInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const scope = await manage.scopeFor(request.user);
    return reply.code(201).send(await manage.createPackage(request.user, scope, parsed.data));
  });

  app.get('/v1/manage/packages/:id', { preHandler: staff }, async (request, reply) => {
    const id = idParam(request, reply);
    if (!id) return reply;
    return manage.getPackage(id, await manage.scopeFor(request.user));
  });

  app.put('/v1/manage/packages/:id', { preHandler: staff }, async (request, reply) => {
    const id = idParam(request, reply);
    if (!id) return reply;
    const parsed = packageInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return manage.updatePackage(request.user, await manage.scopeFor(request.user), id, parsed.data);
  });

  for (const [action, status] of [['publish', 'published'], ['unpublish', 'unpublished']]) {
    app.post(`/v1/manage/packages/:id/${action}`, { preHandler: staff }, async (request, reply) => {
      const id = idParam(request, reply);
      if (!id) return reply;
      return manage.setStatus(request.user, await manage.scopeFor(request.user), id, status);
    });
  }

  app.get('/v1/manage/bookings', { preHandler: staff }, async (request) => {
    const scope = await manage.scopeFor(request.user);
    return { bookings: await manage.listBookings(scope) };
  });

  app.get('/v1/manage/agency-providers', { preHandler: staff }, async (request) => {
    const scope = await manage.scopeFor(request.user);
    return { providers: await manage.listAgencyProviders(scope) };
  });

  app.get('/v1/manage/payouts', { preHandler: staff }, async (request) => manage.listPayouts(await manage.scopeFor(request.user)));

  // ---- admin only --------------------------------------------------------------------
  app.post('/v1/manage/destinations', { preHandler: admin }, async (request, reply) => {
    const parsed = destinationInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return reply.code(201).send(await manage.saveDestination(request.user, parsed.data));
  });

  app.patch('/v1/manage/destinations/:id', { preHandler: admin }, async (request, reply) => {
    const id = idParam(request, reply);
    if (!id) return reply;
    const parsed = destinationInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return manage.saveDestination(request.user, parsed.data, id);
  });

  app.get('/v1/manage/providers', { preHandler: admin }, async () => ({ providers: await manage.listProviders() }));

  app.post('/v1/manage/providers/:id/verify', { preHandler: admin }, async (request, reply) => {
    const id = idParam(request, reply);
    if (!id) return reply;
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    await manage.verifyProvider(request.user, id, parsed.data.verified);
    return reply.code(204).send();
  });

  app.post('/v1/manage/agencies', { preHandler: admin }, async (request, reply) => {
    const parsed = agencyInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return reply.code(201).send(await manage.createAgency(request.user, parsed.data));
  });

  app.post('/v1/manage/agencies/:id/providers/:providerId', { preHandler: admin }, async (request, reply) => {
    const { id, providerId } = request.params;
    if (!UUID.test(id) || !UUID.test(providerId)) return reply.code(404).send({ error: 'not_found' });
    const parsed = linkSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    await manage.linkProvider(request.user, id, providerId, parsed.data.status);
    return reply.code(204).send();
  });

  app.post('/v1/manage/roles', { preHandler: admin }, async (request, reply) => {
    const parsed = rolesInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const r = await manage.setRoles(request.user, parsed.data.email, parsed.data.roles);
    return { userId: r.user_id, roles: r.roles };
  });
}

module.exports = manageRoutes;
