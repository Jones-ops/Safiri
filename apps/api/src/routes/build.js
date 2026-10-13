/**
 * Trip builder API: quotes (server prices) and 15-minute holds.
 *   POST   /v1/quotes        price a package or custom trip; returns a quote valid 15 minutes
 *   POST   /v1/holds         hold the inventory for a quote; returns booking ref + hold token
 *   GET    /v1/holds/:id     hold status (owner, or ?token= for guests)
 *   DELETE /v1/holds/:id     give the hold back early
 */
const { holdRequestSchema, quoteRequestSchema } = require('@safiri/shared');
const { QuoteError } = require('../services/quotes');
const { HoldError } = require('../services/holds');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(reply, error) {
  return reply.code(400).send({
    error: 'invalid_request',
    issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

async function buildRoutes(app, { quotes, holds, optionalUser }) {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof QuoteError || err instanceof HoldError) {
      return reply.code(err.status).send({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'bad_request', message: err.message });
    request.log.error({ err }, 'build route failed');
    return reply.code(500).send({ error: 'server_error' });
  });

  app.post('/v1/quotes', { preHandler: optionalUser, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = quoteRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const quote = await quotes.createQuote(parsed.data, { userId: request.user?.id });
    return reply.code(201).send(quote);
  });

  // Holds take real inventory: keep the rate low to stop anyone squatting rooms.
  app.post('/v1/holds', { preHandler: optionalUser, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = holdRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const hold = await holds.placeHold({ ...parsed.data, userId: request.user?.id });
    return reply.code(201).send(hold);
  });

  /** The owner (signed in) or whoever has the hold token may see or release a hold. */
  async function authorisedHold(request, reply) {
    const { id } = request.params;
    if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });
    const hold = await holds.getHold(id);
    const owner = hold && hold.user_id && request.user?.id === hold.user_id;
    if (!hold || (!owner && !holds.tokenMatches(id, request.query.token))) {
      return reply.code(404).send({ error: 'not_found' }); // never confirm a booking exists to strangers
    }
    return hold;
  }

  app.get('/v1/holds/:id', { preHandler: optionalUser }, async (request, reply) => {
    const hold = await authorisedHold(request, reply);
    if (reply.sent) return reply;
    return {
      bookingId: hold.id,
      ref: hold.ref,
      status: hold.status,
      holdExpiresAt: hold.hold_expires_at?.toISOString() ?? null,
      totalKes: hold.total_kes,
      perPersonKes: hold.per_person_kes,
      travellers: hold.travellers,
      startDate: hold.start_date,
      endDate: hold.end_date,
      packageSlug: hold.package_slug,
      title: hold.package_title,
      destinationName: hold.destination_name,
    };
  });

  app.delete('/v1/holds/:id', { preHandler: optionalUser }, async (request, reply) => {
    const hold = await authorisedHold(request, reply);
    if (reply.sent) return reply;
    const released = await holds.cancelHold(hold.id);
    return reply.code(released ? 200 : 409).send({ released, status: released ? 'cancelled' : hold.status });
  });
}

module.exports = buildRoutes;
