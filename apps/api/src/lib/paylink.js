/**
 * Short signed codes that stand for a database row in a link: pay links (an instalment) and
 * provider request links (a booking item). The code carries a signature, so links can't be
 * guessed or edited to point at someone else's row, and each purpose signs differently, so a
 * pay code can never be used as a request code.
 * Format: <uuid as 22-char base64url>.<12-char signature>
 */
const crypto = require('node:crypto');

function createSignedCodes(secret, purpose) {
  const key = secret || crypto.randomBytes(32).toString('base64url');
  const sign = (id) => crypto.createHmac('sha256', key).update(`${purpose}:${id}`).digest('base64url').slice(0, 12);

  return {
    codeFor(id) {
      const packed = Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
      return `${packed}.${sign(id)}`;
    },

    /** Returns the row id, or null if the code is malformed or the signature is wrong. */
    idFrom(code) {
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

/** Pay links: the code stands for an instalment. */
function createPayLinks(secret) {
  const codes = createSignedCodes(secret, 'pay');
  return { codeFor: codes.codeFor, instalmentIdFrom: codes.idFrom };
}

module.exports = { createSignedCodes, createPayLinks };
