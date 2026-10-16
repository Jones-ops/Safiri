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

const { UUID } = require('../lib/access');

async function payRoutes(app, { config, payments, cancellations, settlement, mayAccess, optionalUser, requireUser }) {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof PaymentError) {
      return reply.code(err.status).send({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'bad_request' });
    request.log.error({ err }, 'payment route failed');
    return reply.code(500).send({ error: 'server_error' });
  });

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

  // Cancel and refund: the traveller sees the exact refund first, then confirms.
  app.get('/v1/bookings/:id/cancel', { preHandler: optionalUser }, async (request, reply) => {
    if (!(await mayAccess(request, request.params.id, request.query.token))) return reply.code(404).send({ error: 'not_found' });
    return cancellations.preview(request.params.id);
  });

  app.post('/v1/bookings/:id/cancel', { preHandler: optionalUser, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!(await mayAccess(request, request.params.id, request.body?.token))) return reply.code(404).send({ error: 'not_found' });
    return cancellations.cancel(request.params.id, request.user?.id || null);
  });

  // Daraja's B2C result callback (payouts and refunds), behind the same secret as the STK one.
  app.post('/hooks/mpesa/b2c/:secret', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const given = Buffer.from(String(request.params.secret));
    if (!expected || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const outcome = await settlement.handleB2cResult(request.body);
      request.log.info({ outcome }, 'M-PESA B2C result');
    } catch (err) {
      request.log.error({ err }, 'B2C result failed');
    }
    return { ResultCode: 0, ResultDesc: 'Accepted' };
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
