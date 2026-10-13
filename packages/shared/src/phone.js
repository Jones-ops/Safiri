/**
 * Kenyan mobile numbers. The phone number is the user's identity, so every number is
 * stored in one form: 2547XXXXXXXX or 2541XXXXXXXX (the form M-Pesa and Supabase use).
 */

const KENYA_MSISDN = /^254(7|1)\d{8}$/;

/**
 * Turn what someone typed into 2547XXXXXXXX / 2541XXXXXXXX, or null if it isn't a
 * Kenyan mobile number. Accepts 0712 345 678, +254 712 345 678, 254712345678, 712345678.
 */
function normalizeMsisdn(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let digits = String(input).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  if (digits.startsWith('0') && digits.length === 10) digits = '254' + digits.slice(1);
  else if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) digits = '254' + digits;

  return KENYA_MSISDN.test(digits) ? digits : null;
}

function isValidMsisdn(input) {
  return normalizeMsisdn(input) !== null;
}

/** 254712345678 -> "0712 345 678", the way Kenyans write their numbers. */
function formatMsisdn(msisdn) {
  const normal = normalizeMsisdn(msisdn);
  if (!normal) return String(msisdn ?? '');
  const local = '0' + normal.slice(3);
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** E.164 form (+254...) for Supabase Auth and SMS providers. */
function toE164(input) {
  const normal = normalizeMsisdn(input);
  return normal ? '+' + normal : null;
}

module.exports = { normalizeMsisdn, isValidMsisdn, formatMsisdn, toE164 };
