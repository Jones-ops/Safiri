/**
 * 15-minute holds. The work happens in the place_hold / cancel_hold database functions so
 * the check-and-take is one transaction (see the _build migration). This file maps their
 * errors to HTTP and signs the guest hold token.
 */
const crypto = require('node:crypto');

const HOLD_ERRORS = {
  quote_not_found: 404,
  quote_expired: 410,
  quote_used: 409,
  too_many_holds: 429,
  sold_out: 409,
};

class HoldError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function createHoldService(db, { tokenSecret }) {
  // In development without a secret, tokens stop working after a restart, which is harmless.
  const secret = tokenSecret || crypto.randomBytes(32).toString('base64url');

  const tokenFor = (bookingId) => crypto.createHmac('sha256', secret).update(`hold:${bookingId}`).digest('base64url');
  const tokenMatches = (bookingId, token) => {
    if (typeof token !== 'string') return false;
    const expected = Buffer.from(tokenFor(bookingId));
    const given = Buffer.from(token);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  };

  function need() {
    if (!db) throw new HoldError('not_configured', 503);
    return db;
  }

  return {
    tokenMatches,

    async placeHold({ quoteId, phone, userId }) {
      try {
        const { rows } = await need().query('select * from place_hold($1, $2, $3)', [quoteId, phone, userId || null]);
        const h = rows[0];
        return {
          bookingId: h.booking_id,
          ref: h.ref,
          holdExpiresAt: h.hold_expires_at.toISOString(),
          totalKes: h.total_kes,
          holdToken: tokenFor(h.booking_id),
        };
      } catch (err) {
        if (HOLD_ERRORS[err.message]) throw new HoldError(err.message, HOLD_ERRORS[err.message]);
        throw err;
      }
    },

    async getHold(bookingId) {
      const { rows } = await need().query(
        `select b.id, b.ref, b.status, b.user_id, b.hold_expires_at, b.total_kes, b.travellers,
                b.start_date::text, b.end_date::text, p.slug as package_slug, p.title as package_title,
                d.name as destination_name, q.per_person_kes
         from bookings b
         left join packages p on p.id = b.package_id
         left join quotes q on q.id = b.quote_id
         left join destinations d on d.id = coalesce(p.destination_id, q.destination_id)
         where b.id = $1`,
        [bookingId],
      );
      return rows[0] || null;
    },

    async cancelHold(bookingId) {
      const { rows } = await need().query('select cancel_hold($1) as ok', [bookingId]);
      return rows[0].ok;
    },

    async releaseExpired() {
      const { rows } = await need().query('select release_expired_holds() as n');
      return rows[0].n;
    },
  };
}

module.exports = { createHoldService, HoldError };
