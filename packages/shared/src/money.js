/**
 * Money rules for Safiri. Every amount is an integer number of Kenyan shillings (KES).
 *
 * THE ROUNDING RULE (the only one; the API and the app both use this file):
 *   1. Provider net    = sum of (item net price x quantity).
 *   2. Agency margin   = net x margin %, rounded half up to a whole shilling.
 *   3. Traveller price = (net + margin) x (1 + platform fee %), rounded UP to the next KES 50.
 *   4. Platform fee    = traveller price - net - margin. The fee absorbs the rounding,
 *                        so the parts always add up exactly to the price.
 *   5. Deposit         = traveller price x deposit %, rounded UP to a whole shilling.
 *   6. Instalments     = the rest, split evenly in whole shillings; any remainder goes
 *                        on the LAST instalment.
 * Percentages are passed as basis points (1% = 100 bps) so the maths stays in integers.
 */

const ROUND_TO_KES = 50;

function assertKes(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a whole, non-negative number of KES (got ${value})`);
  }
}

/** Divide and round half up, using integers only. */
function divRoundHalfUp(numerator, denominator) {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Divide and round up, using integers only. */
function divCeil(numerator, denominator) {
  return Math.floor((numerator + denominator - 1) / denominator);
}

/**
 * Build the per-person price from provider items.
 * @param {{ items: {netKes:number, qty:number, label?:string}[], marginBps:number, feeBps:number }} input
 */
function priceBreakdown({ items, marginBps, feeBps }) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('items must be a non-empty array');
  assertKes(marginBps, 'marginBps');
  assertKes(feeBps, 'feeBps');

  const lines = items.map((item) => {
    assertKes(item.netKes, 'item.netKes');
    assertKes(item.qty, 'item.qty');
    return { label: item.label || null, netKes: item.netKes, qty: item.qty, lineKes: item.netKes * item.qty };
  });
  const netKes = lines.reduce((sum, line) => sum + line.lineKes, 0);
  const marginKes = divRoundHalfUp(netKes * marginBps, 10000);
  const beforeFee = netKes + marginKes;
  // (net + margin) x (10000 + fee bps) / 10000, rounded up to the next KES 50.
  const totalKes = divCeil(beforeFee * (10000 + feeBps), 10000 * ROUND_TO_KES) * ROUND_TO_KES;
  const feeKes = totalKes - beforeFee;

  return { lines, netKes, marginKes, feeKes, totalKes };
}

/**
 * Split a price into a deposit and equal instalments.
 * @returns {{ depositKes:number, instalments:number[] }}
 */
function paymentSchedule({ totalKes, depositPct, instalmentCount }) {
  assertKes(totalKes, 'totalKes');
  if (!(depositPct > 0 && depositPct <= 100)) throw new RangeError('depositPct must be 1 to 100');
  if (!Number.isInteger(instalmentCount) || instalmentCount < 0) throw new RangeError('instalmentCount must be 0 or more');

  const depositKes = instalmentCount === 0 ? totalKes : divCeil(totalKes * depositPct, 100);
  const rest = totalKes - depositKes;
  if (instalmentCount === 0 || rest === 0) return { depositKes: totalKes, instalments: [] };

  const each = Math.floor(rest / instalmentCount);
  const instalments = Array.from({ length: instalmentCount }, () => each);
  instalments[instalmentCount - 1] += rest - each * instalmentCount;
  return { depositKes, instalments };
}

/** "KES 15,700". Uses a fixed format so the app and web pages match on every phone. */
function formatKes(amountKes) {
  const sign = amountKes < 0 ? '-' : '';
  const digits = String(Math.abs(Math.round(amountKes))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}KES ${digits}`;
}

/** "15,700" without the currency, for tight spaces such as "4 x 3,925". */
function formatAmount(amountKes) {
  return formatKes(amountKes).replace('KES ', '');
}

module.exports = { priceBreakdown, paymentSchedule, formatKes, formatAmount, ROUND_TO_KES };
