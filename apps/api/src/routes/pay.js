/**
 * Checkout and M-PESA:
 *   GET  /v1/bookings/:id              booking summary, checkout options, payments, schedule
 *   POST /v1/payments                  start an STK push for the deposit or the full amount
 *   GET  /v1/payments/:id              payment status (falls back to STK Query when slow)
 *   POST /v1/bookings/:id/claim        attach a guest booking to the signed-in traveller
 *   POST /hooks/mpesa/stk/:secret      Daraja's callback (unsigned; confirmed by STK Query)
 * Access to a booking: its signed-in owner, or whoever has the booking's token.
 */
const crypto = require('node:crypto');
const { paymentRequestSchema } = require('@safiri/shared');
const { PaymentError } = require('../services/payments');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function payRoutes(app, { config, payments, holds, optionalUser, requireUser }) {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof PaymentError) {
      return reply.code(err.status).send({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'bad_request' });
    request.log.error({ err }, 'payment route failed');
    return reply.code(500).send({ error: 'server_error' });
  });

  /** True when the request may see this booking. Never reveals whether it exists. */
  async function mayAccess(request, bookingId, token) {
    if (!UUID.test(String(bookingId))) return false;
    const owner = await payments.bookingOwner(bookingId);
    if (!owner) return false;
    if (owner.user_id && request.user?.id === owner.user_id) return true;
    return holds.tokenMatches(bookingId, token);
  }

  app.get('/v1/bookings/:id', { preHandler: optionalUser }, async (request, reply) => {
    if (!(await mayAccess(request, request.params.id, request.query.token))) return reply.code(404).send({ error: 'not_found' });
    const summary = await payments.bookingSummary(request.params.id);
    const { userId, ...rest } = summary;
    return { ...rest, claimed: Boolean(userId) };
  });

  app.post('/v1/payments', { preHandler: optionalUser, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = paymentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const { bookingId, option, phone, token } = parsed.data;
    if (!(await mayAccess(request, bookingId, token))) return reply.code(404).send({ error: 'not_found' });
    const started = await payments.startPayment({ bookingId, option, phone });
    return reply.code(201).send(started);
  });

  app.get('/v1/payments/:id', { preHandler: optionalUser }, async (request, reply) => {
    const { id } = request.params;
    const bookingId = UUID.test(id) ? await payments.paymentBookingId(id) : null;
    if (!bookingId || !(await mayAccess(request, bookingId, request.query.token))) return reply.code(404).send({ error: 'not_found' });
    const p = await payments.getPayment(id);
    return {
      paymentId: p.id,
      bookingId: p.booking_id,
      ref: p.ref,
      status: p.status,
      amountKes: p.amount_kes,
      receipt: p.mpesa_receipt?.startsWith('UNKNOWN-') ? null : p.mpesa_receipt,
      resultDesc: p.status === 'succeeded' ? null : p.result_desc,
      bookingStatus: p.booking_status,
    };
  });

  app.post('/v1/bookings/:id/claim', { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params;
    if (!(await mayAccess(request, id, request.body?.token))) return reply.code(404).send({ error: 'not_found' });
    const claimed = await payments.claimBooking(id, request.user);
    return reply.code(claimed ? 200 : 409).send({ claimed });
  });

  // Daraja calls this. The secret in the path keeps out random traffic; the STK Query check
  // is what makes it safe. Daraja always gets "Accepted": what we do with it is our business.
  const expected = config.DARAJA_CALLBACK_SECRET ? Buffer.from(config.DARAJA_CALLBACK_SECRET) : null;
  app.post('/hooks/mpesa/stk/:secret', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const given = Buffer.from(String(request.params.secret));
    if (!expected || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const outcome = await payments.handleCallback(request.body);
      request.log.info({ outcome }, 'M-PESA callback');
    } catch (err) {
      request.log.error({ err }, 'M-PESA callback failed; the reconcile job will settle it');
    }
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  });
}

module.exports = payRoutes;
