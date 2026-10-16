/**
 * The signed-in traveller's account:
 *   GET    /v1/me/export      everything we hold about them (JSON)
 *   DELETE /v1/me             delete the account (records the law requires are kept, anonymised)
 *   GET    /v1/me/referral    their referral code, and any reward codes earned
 *   POST   /v1/me/reviews     review a completed trip { bookingId, rating, body, mediaPaths }
 */
const { z } = require('@safiri/shared');

const reviewSchema = z.object({
  bookingId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(2000).optional(),
  mediaPaths: z.array(z.string().max(300)).max(6).optional(),
}).strict();

async function accountRoutes(app, { account, db, requireUser }) {
  app.get('/v1/me/export', { preHandler: requireUser, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request, reply) => {
    const data = await account.exportData(request.user.id);
    return reply.header('content-disposition', 'attachment; filename="safiri-my-data.json"').send(data);
  });

  app.delete('/v1/me', { preHandler: requireUser, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request, reply) => {
    await account.deleteAccount(request.user.id);
    return reply.code(204).send();
  });

  app.get('/v1/me/referral', { preHandler: requireUser }, async (request) => account.myReferral(request.user.id));

  // Reviews go through the API so the "completed booking, own booking" rule is one place (the
  // database trigger enforces it too) and the media rows are linked in the same transaction.
  app.post('/v1/me/reviews', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const { bookingId, rating, body, mediaPaths = [] } = parsed.data;
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: request.user.id, role: 'service_role' })]);
      const review = await client.query(
        `insert into reviews (booking_id, user_id, rating, body) values ($1, $2, $3, $4) returning id`,
        [bookingId, request.user.id, rating, body || null],
      );
      for (const path of mediaPaths) {
        if (!path.startsWith(`${request.user.id}/`)) throw Object.assign(new Error('media path must be under your own folder'), { statusCode: 400, code: 'invalid_media_path' });
        await client.query(
          `insert into media (owner_id, review_id, bucket, path, kind, upload_status) values ($1, $2, 'media', $3, $4, 'complete')
           on conflict (bucket, path) do update set review_id = excluded.review_id, upload_status = 'complete'`,
          [request.user.id, review.rows[0].id, path, /\.(mp4|mov)$/i.test(path) ? 'clip' : 'photo'],
        );
      }
      await client.query('commit');
      return reply.code(201).send({ reviewId: review.rows[0].id });
    } catch (err) {
      await client.query('rollback').catch(() => {});
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.code });
      if (/only a completed booking|only a traveller on this booking/.test(err.message)) return reply.code(409).send({ error: 'not_reviewable' });
      if (err.code === '23505') return reply.code(409).send({ error: 'already_reviewed' });
      throw err;
    } finally {
      client.release();
    }
  });
}

module.exports = accountRoutes;
