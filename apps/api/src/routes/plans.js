/**
 * Instalments after checkout:
 *   GET  /v1/pay-links/:code                       what a one-tap pay link is for
 *   POST /v1/pay-links/:code/pay                   send the M-PESA prompt for the next payment due
 *   GET  /v1/pay-links/:code/payments/:paymentId   that payment's status
 *   GET  /v1/me/bookings                           the signed-in traveller's trips (Trips tab)
 *   POST /v1/me/push-tokens                        register this phone for payment reminders
 * The signed pay-link code is the authorisation: anyone holding the link can pay it
 * (a friend paying for you is fine), but it can't be guessed or pointed elsewhere.
 */
const { msisdnSchema, z } = require('@safiri/shared');
const { PaymentError } = require('../services/payments');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const payBodySchema = z.object({ phone: msisdnSchema.optional() }).strict();
const pushTokenSchema = z.object({ token: z.string().regex(/^ExponentPushToken\[.+\]$/), platform: z.enum(['android', 'ios']) }).strict();

/** "0712 *** 678": enough for the owner to recognise, not enough to harvest. */
const maskPhone = (msisdn) => `0${msisdn.slice(3, 6)} *** ${msisdn.slice(-3)}`;

async function planRoutes(app, { db, payments, plans, payLinks, requireUser }) {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof PaymentError) return reply.code(err.status).send({ error: err.code });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'bad_request' });
    request.log.error({ err }, 'plan route failed');
    return reply.code(500).send({ error: 'server_error' });
  });

  async function target(code) {
    const instalmentId = payLinks.instalmentIdFrom(code);
    return instalmentId ? plans.payLinkTarget(instalmentId) : null;
  }

  app.get('/v1/pay-links/:code', async (request, reply) => {
    const t = await target(request.params.code);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    return {
      ref: t.ref,
      title: t.title,
      bookingStatus: t.booking_status,
      startDate: t.start,
      endDate: t.end,
      amountKes: t.next_kes,
      balanceKes: t.balance_kes,
      phone: maskPhone(t.phone),
      payable: t.booking_status === 'confirmed' && t.next_kes > 0,
    };
  });

  app.post('/v1/pay-links/:code/pay', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const t = await target(request.params.code);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    const parsed = payBodySchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const started = await payments.startPayment({ bookingId: t.booking_id, option: 'instalment', phone: parsed.data.phone || t.phone });
    return reply.code(201).send(started);
  });

  app.get('/v1/pay-links/:code/payments/:paymentId', async (request, reply) => {
    const t = await target(request.params.code);
    const { paymentId } = request.params;
    if (!t || !UUID.test(paymentId) || (await payments.paymentBookingId(paymentId)) !== t.booking_id) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const p = await payments.getPayment(paymentId);
    return { paymentId: p.id, status: p.status, amountKes: p.amount_kes, receipt: p.mpesa_receipt?.startsWith('UNKNOWN-') ? null : p.mpesa_receipt, bookingStatus: p.booking_status };
  });

  app.get('/v1/me/bookings', { preHandler: requireUser }, async (request) => {
    const { rows } = await db.query(
      `select b.id from bookings b
       where b.user_id = $1 and b.status in ('confirmed', 'fully_paid', 'completed', 'cancelled')
       order by b.start_date desc limit 50`,
      [request.user.id],
    );
    const trips = [];
    for (const r of rows) {
      const { userId, options, ...summary } = await payments.bookingSummary(r.id);
      trips.push(summary);
    }
    return { trips };
  });

  app.post('/v1/me/push-tokens', { preHandler: requireUser }, async (request, reply) => {
    const parsed = pushTokenSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    await db.query(
      `insert into push_tokens (user_id, token, platform) values ($1, $2, $3)
       on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, disabled_at = null`,
      [request.user.id, parsed.data.token, parsed.data.platform],
    );
    return reply.code(204).send();
  });
}

module.exports = planRoutes;
