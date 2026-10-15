/**
 * Group split:
 *   POST /v1/bookings/:id/split                    organiser splits a held booking into shares
 *   GET  /v1/bookings/:id/group                    live status: who has paid (polled every 3 s)
 *   POST /v1/bookings/:id/group/:memberId/cover    organiser takes over a friend's unpaid share
 *   GET  /v1/invites/:code                         a member's invite: their share and the trip
 *   POST /v1/invites/:code/pay                     send that member the M-PESA prompt
 *   GET  /v1/invites/:code/payments/:paymentId     that payment's status
 * The organiser's routes need the booking (owner or token); an invite code is its own key.
 */
const { splitRequestSchema, msisdnSchema, z } = require('@safiri/shared');
const { PaymentError } = require('../services/payments');
const { GroupError } = require('../services/groups');
const { UUID } = require('../lib/access');

const payBodySchema = z.object({ phone: msisdnSchema.optional() }).strict();

async function groupRoutes(app, { payments, groups, mayAccess, optionalUser }) {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof PaymentError || err instanceof GroupError) return reply.code(err.status).send({ error: err.code });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'bad_request' });
    request.log.error({ err }, 'group route failed');
    return reply.code(500).send({ error: 'server_error' });
  });

  app.post('/v1/bookings/:id/split', { preHandler: optionalUser }, async (request, reply) => {
    const parsed = splitRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const { token, ...split } = parsed.data;
    if (!(await mayAccess(request, request.params.id, token))) return reply.code(404).send({ error: 'not_found' });
    return reply.code(201).send(await groups.createSplit({ bookingId: request.params.id, ...split }));
  });

  app.get('/v1/bookings/:id/group', { preHandler: optionalUser }, async (request, reply) => {
    if (!(await mayAccess(request, request.params.id, request.query.token))) return reply.code(404).send({ error: 'not_found' });
    const status = await groups.groupStatus(request.params.id);
    return status || reply.code(404).send({ error: 'not_a_group' });
  });

  app.post('/v1/bookings/:id/group/:memberId/cover', { preHandler: optionalUser }, async (request, reply) => {
    const { id, memberId } = request.params;
    if (!UUID.test(memberId) || !(await mayAccess(request, id, request.body?.token))) return reply.code(404).send({ error: 'not_found' });
    const moved = await groups.cover(id, memberId);
    return { moved, group: await groups.groupStatus(id) };
  });

  app.get('/v1/invites/:code', async (request, reply) => {
    const t = await groups.inviteTarget(request.params.code);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    const { memberId, bookingId, msisdn, ...visible } = t;
    return visible;
  });

  app.post('/v1/invites/:code/pay', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const t = await groups.inviteTarget(request.params.code);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    const parsed = payBodySchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const started = await payments.startSharePayment({ memberId: t.memberId, phone: parsed.data.phone || t.msisdn });
    return reply.code(201).send(started);
  });

  app.get('/v1/invites/:code/payments/:paymentId', async (request, reply) => {
    const t = await groups.inviteTarget(request.params.code);
    const { paymentId } = request.params;
    if (!t || !UUID.test(paymentId) || (await payments.paymentBookingId(paymentId)) !== t.bookingId) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const p = await payments.getPayment(paymentId);
    if (p.member_id !== t.memberId) return reply.code(404).send({ error: 'not_found' });
    return { paymentId: p.id, status: p.status, amountKes: p.amount_kes, receipt: p.mpesa_receipt?.startsWith('UNKNOWN-') ? null : p.mpesa_receipt, bookingStatus: p.booking_status };
  });
}

module.exports = groupRoutes;
