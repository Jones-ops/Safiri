const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify, packageInputSchema, providerOnboardSchema, blockDatesSchema } = require('../src/manage');

const listing = '00000000-0000-4000-8000-000000000001';
const destination = '00000000-0000-4000-8000-000000000002';
const validPackage = {
  destinationId: destination, title: 'Naivasha Lakeside Weekend', nights: 2, marginBps: 1500, depositPct: 25,
  instalments: 3, finalDueDays: 7, graceDays: 2, cancelPolicy: [{ days_before: 30, refund_pct: 100 }, { days_before: 0, refund_pct: 0 }],
  inclusions: ['Shuttle'], exclusions: [], items: [{ listingId: listing, day: 1, qty: 2, startTime: '12:00' }],
};

test('slugs are lower-case, hyphenated and bounded', () => {
  assert.equal(slugify('Naivasha Lakeside Weekend!'), 'naivasha-lakeside-weekend');
  assert.equal(slugify('  Mara: 3 nights (July) '), 'mara-3-nights-july');
  assert.equal(slugify('!!!'), 'trip');
  assert.ok(slugify('x'.repeat(100)).length <= 60);
});

test('a package needs its items inside the trip and a final cancellation tier', () => {
  assert.ok(packageInputSchema.safeParse(validPackage).success);
  assert.equal(packageInputSchema.safeParse({ ...validPackage, items: [{ listingId: listing, day: 4, qty: 1 }] }).success, false, 'day 4 of a 2-night trip');
  assert.equal(packageInputSchema.safeParse({ ...validPackage, cancelPolicy: [{ days_before: 30, refund_pct: 100 }] }).success, false);
  assert.equal(packageInputSchema.safeParse({ ...validPackage, marginBps: 9000 }).success, false, 'margin capped at 50%');
  assert.equal(packageInputSchema.safeParse({ ...validPackage, status: 'published' }).success, false, 'status is set by publish, not edit');
});

test('provider onboarding normalises both phone numbers', () => {
  const r = providerOnboardSchema.parse({
    type: 'lodge', name: 'Ziwa Shores', destinationId: destination, whatsappPhone: '0712 000 111', payoutPhone: '+254712000222',
    listing: { title: 'Lake room', kind: 'stay', unit: 'night', capacity: 10, netKes: 4500 },
  });
  assert.equal(r.whatsappPhone, '254712000111');
  assert.equal(r.payoutPhone, '254712000222');
});

test('blocking dates takes plain dates only', () => {
  assert.ok(blockDatesSchema.safeParse({ dates: ['2026-12-24', '2026-12-25'], blocked: true }).success);
  assert.equal(blockDatesSchema.safeParse({ dates: ['24/12/2026'], blocked: true }).success, false);
});
