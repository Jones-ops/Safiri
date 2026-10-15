/** Group split rules shared by the API and the app. */
const { MPESA_MAX_TRANSACTION_KES } = require('./constants');

/**
 * Equal shares in whole shillings. The organiser (index 0) takes the odd shillings, so
 * friends always see a round, equal number.
 */
function splitEqually(totalKes, people) {
  if (!Number.isInteger(people) || people < 1) throw new RangeError('people must be 1 or more');
  const each = Math.floor(totalKes / people);
  return [totalKes - each * (people - 1), ...Array(people - 1).fill(each)];
}

/** null when custom shares are valid; otherwise the reason. */
function checkShares(shares, totalKes) {
  if (!shares.length) return 'no_shares';
  if (shares.some((s) => !Number.isInteger(s) || s < 1)) return 'invalid_share';
  if (shares.some((s) => s > MPESA_MAX_TRANSACTION_KES)) return 'share_over_limit';
  if (shares.reduce((a, b) => a + b, 0) !== totalKes) return 'shares_do_not_add_up';
  return null;
}

module.exports = { splitEqually, checkShares, GROUP_HOLD_MINUTES: 60 };
