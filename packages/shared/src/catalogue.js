/** Helpers for showing packages the same way in the app and on the public web pages. */
const { paymentSchedule } = require('./money');

/**
 * The instalment line under a price: "or 4 x 3,925". times counts the deposit; amountKes is
 * the deposit (the first and largest-or-equal payment). Null when the package is pay-in-full.
 */
function instalmentPreview({ totalKes, depositPct, instalmentCount }) {
  if (!totalKes || !instalmentCount) return null;
  const plan = paymentSchedule({ totalKes, depositPct, instalmentCount });
  if (!plan.instalments.length) return null;
  return { times: plan.instalments.length + 1, amountKes: plan.depositKes, schedule: [plan.depositKes, ...plan.instalments] };
}

// Photos live in the public Supabase Storage bucket in two widths.
const PHOTO_BUCKET = 'public-images';
const PHOTO_SIZES = Object.freeze([640, 1280]);

/**
 * Public URL of a destination or package photo. key is the hero_image column, e.g.
 * "naivasha-lake". size 640 for lists and data saver, 1280 for full-width heroes.
 */
function photoUrl(supabaseUrl, key, size = 1280) {
  if (!supabaseUrl || !key) return null;
  const width = PHOTO_SIZES.includes(size) ? size : 1280;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${PHOTO_BUCKET}/photos/${encodeURIComponent(key)}-${width}.jpg`;
}

/** Refund tiers of a cancellation policy, most generous first. */
function refundTiers(cancelPolicy) {
  return [...(cancelPolicy || [])].sort((a, b) => b.days_before - a.days_before);
}

/**
 * The policy in plain words, one line per tier, e.g. "14 to 29 days before travel: 50% back".
 * t is an i18next-style translate function (app) or the web translator (API); both use the
 * same pkg.* strings.
 */
function refundLines(cancelPolicy, t) {
  const tiers = refundTiers(cancelPolicy);
  return tiers.map((tier, i) => {
    const result = tier.refund_pct > 0 ? t('pkg.pctBack', { pct: tier.refund_pct }) : t('pkg.noRefund');
    if (i === 0) return t('pkg.refundFromMore', { from: tier.days_before, result });
    const prev = tiers[i - 1].days_before;
    if (tier.days_before === 0) return t('pkg.refundUnder', { days: prev, result });
    return t('pkg.refundBetween', { from: tier.days_before, to: prev - 1, result });
  });
}

module.exports = { instalmentPreview, photoUrl, refundTiers, refundLines, PHOTO_BUCKET, PHOTO_SIZES };
