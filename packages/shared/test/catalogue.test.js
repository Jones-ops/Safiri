const test = require('node:test');
const assert = require('node:assert/strict');
const { instalmentPreview, photoUrl, refundTiers } = require('../src/catalogue');

test('instalment preview matches the plan example: or 4 x 3,925', () => {
  const p = instalmentPreview({ totalKes: 15700, depositPct: 25, instalmentCount: 3 });
  assert.equal(p.times, 4);
  assert.equal(p.amountKes, 3925);
  assert.deepEqual(p.schedule, [3925, 3925, 3925, 3925]);
});

test('pay-in-full packages have no instalment line', () => {
  assert.equal(instalmentPreview({ totalKes: 8100, depositPct: 100, instalmentCount: 0 }), null);
});

test('photo URLs point at the public bucket in two sizes', () => {
  assert.equal(
    photoUrl('https://x.supabase.co/', 'naivasha-lake', 640),
    'https://x.supabase.co/storage/v1/object/public/public-images/photos/naivasha-lake-640.jpg',
  );
  assert.match(photoUrl('https://x.supabase.co', 'diani-boat', 999), /diani-boat-1280\.jpg$/);
  assert.equal(photoUrl(null, 'x'), null);
});

test('refund tiers are listed most generous first', () => {
  const tiers = refundTiers([{ days_before: 0, refund_pct: 0 }, { days_before: 30, refund_pct: 100 }, { days_before: 14, refund_pct: 50 }]);
  assert.deepEqual(tiers.map((t) => t.days_before), [30, 14, 0]);
});
