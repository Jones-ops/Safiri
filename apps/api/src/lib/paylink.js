/**
 * One-tap pay links: https://<site>/pay/<code>. The code names an instalment and carries a
 * signature, so links can't be guessed or edited to point at someone else's booking.
 * Format: <instalment id as 22-char base64url>.<12-char signature>
 */
const crypto = require('node:crypto');

function createPayLinks(secret) {
  const key = secret || crypto.randomBytes(32).toString('base64url');
  const sign = (id) => crypto.createHmac('sha256', key).update(`pay:${id}`).digest('base64url').slice(0, 12);

  return {
    codeFor(instalmentId) {
      const id = Buffer.from(instalmentId.replace(/-/g, ''), 'hex').toString('base64url');
      return `${id}.${sign(instalmentId)}`;
    },

    /** Returns the instalment id, or null if the code is malformed or the signature is wrong. */
    instalmentIdFrom(code) {
      const match = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{12})$/.exec(String(code || ''));
      if (!match) return null;
      const hex = Buffer.from(match[1], 'base64url').toString('hex');
      if (hex.length !== 32) return null;
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const expected = Buffer.from(sign(id));
      const given = Buffer.from(match[2]);
      return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? id : null;
    },
  };
}

module.exports = { createPayLinks };
