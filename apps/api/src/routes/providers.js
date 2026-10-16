/**
 * Provider self-service (role: provider; onboarding needs any signed-in user):
 *   GET  /v1/provider/me                         my providers and their listings
 *   POST /v1/provider/onboard                    sign up a provider + first listing (unverified until admin checks)
 *   GET  /v1/provider/requests                   booking requests, open and recent
 *   POST /v1/provider/requests/:code/respond     { accept } for the request a code stands for
 *   GET  /v1/provider/listings/:id/calendar?month=YYYY-MM
 *   POST /v1/provider/listings/:id/block         { dates, blocked }
 *   GET  /v1/provider/listings/:id/prices
 *   PUT  /v1/provider/listings/:id/prices        { seasons: [...] }
 *   GET  /v1/provider/payouts
 */
const { blockDatesSchema, priceSeasonSchema, providerOnboardSchema, z } = require('@safiri/shared');
const { ProviderError } = require('../services/providers');
const { UUID } = require('../lib/access');

const respondSchema = z.object({ accept: z.boolean() }).strict();
const seasonsSchema = z.object({ seasons: z.array(priceSeasonSchema).min(1).max(12) }).strict();
const invalid = (reply, error) =>
  reply.code(400).send({ error: 'invalid_request', issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

async function providerRoutes(app, { providers, requireUser, requireRole }) {
  const provider = requireRole('provider', 'admin');

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ProviderError) return reply.code(err.status).send({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'bad_request' });
    request.log.error({ err }, 'provider route failed');
    return reply.code(500).send({ error: 'server_error' });
  });

  app.get('/v1/provider/me', { preHandler: requireUser }, async (request) => ({ providers: await providers.myProviders(request.user.id) }));

  app.post('/v1/provider/onboard', { preHandler: requireUser, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const parsed = providerOnboardSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    return reply.code(201).send(await providers.onboard(request.user, parsed.data));
  });

  app.get('/v1/provider/requests', { preHandler: provider }, async (request) => ({ requests: await providers.listRequests(request.user.id) }));

  app.post('/v1/provider/requests/:code/respond', { preHandler: provider }, async (request, reply) => {
    const parsed = respondSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const target = await providers.requestByCode(request.params.code);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    return providers.respond({ firstItemId: target.firstItemId, accept: parsed.data.accept, actorUserId: request.user.id, requireOwner: request.user.id });
  });

  const listingId = (request, reply) => {
    if (!UUID.test(String(request.params.id))) {
      reply.code(404).send({ error: 'not_found' });
      return null;
    }
    return request.params.id;
  };

  app.get('/v1/provider/listings/:id/calendar', { preHandler: provider }, async (request, reply) => {
    const id = listingId(request, reply);
    if (!id) return reply;
    const month = String(request.query.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply.code(400).send({ error: 'invalid_request' });
    return { days: await providers.calendar(request.user.id, id, month) };
  });

  app.post('/v1/provider/listings/:id/block', { preHandler: provider }, async (request, reply) => {
    const id = listingId(request, reply);
    if (!id) return reply;
    const parsed = blockDatesSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    await providers.blockDates(request.user, id, parsed.data.dates, parsed.data.blocked);
    return reply.code(204).send();
  });

  app.get('/v1/provider/listings/:id/prices', { preHandler: provider }, async (request, reply) => {
    const id = listingId(request, reply);
    if (!id) return reply;
    return { seasons: await providers.seasons(request.user.id, id) };
  });

  app.put('/v1/provider/listings/:id/prices', { preHandler: provider }, async (request, reply) => {
    const id = listingId(request, reply);
    if (!id) return reply;
    const parsed = seasonsSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    await providers.setSeasons(request.user, id, parsed.data.seasons);
    return { seasons: await providers.seasons(request.user.id, id) };
  });

  app.get('/v1/provider/payouts', { preHandler: provider }, async (request) => providers.payouts(request.user.id));
}

module.exports = providerRoutes;
