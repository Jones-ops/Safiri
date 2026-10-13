const test = require('node:test');
const assert = require('node:assert/strict');
const { expandLines, addDays, todayInKenya, driveTimeWarning } = require('../src/trip');
const { quoteRequestSchema, holdRequestSchema } = require('../src/schemas');

test('stays take one room per two travellers, one line per night', () => {
  const lines = expandLines([{ ref: 'lodge', unit: 'night', day: 1, qty: 2 }], 3);
  assert.deepEqual(lines, [
    { ref: 'lodge', dayIndex: 0, units: 2, perPersonQty: 1 },
    { ref: 'lodge', dayIndex: 1, units: 2, perPersonQty: 1 },
  ]);
});

test('game drives take a place per traveller per day; one-off items one line', () => {
  assert.deepEqual(expandLines([{ ref: 'drive', unit: 'day', day: 2, qty: 2 }], 2), [
    { ref: 'drive', dayIndex: 1, units: 2, perPersonQty: 1 },
    { ref: 'drive', dayIndex: 2, units: 2, perPersonQty: 1 },
  ]);
  assert.deepEqual(expandLines([{ ref: 'boat', unit: 'person', day: 2, qty: 1 }], 4), [
    { ref: 'boat', dayIndex: 1, units: 4, perPersonQty: 1 },
  ]);
});

test('date helpers', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(todayInKenya(new Date('2026-10-13T22:30:00Z')), '2026-10-14', 'EAT is already the next day');
});

test('drive-time warning for long roads on short trips', () => {
  assert.equal(driveTimeWarning(5.5, 1), true);
  assert.equal(driveTimeWarning(5.5, 2), false);
  assert.equal(driveTimeWarning(2, 0), false);
});

test('quote requests: a package, or a custom trip with items and nights', () => {
  assert.ok(quoteRequestSchema.safeParse({ packageSlug: 'naivasha-day-escape', startDate: '2026-11-07', travellers: 2 }).success);
  const custom = {
    destinationSlug: 'naivasha', nights: 1, startDate: '2026-11-07', travellers: 2,
    items: [{ listingId: '00000000-0000-4000-8000-000000000001', day: 1, qty: 1 }],
  };
  assert.ok(quoteRequestSchema.safeParse(custom).success);
  assert.equal(quoteRequestSchema.safeParse({ ...custom, packageSlug: 'x' }).success, false, 'not both');
  assert.equal(quoteRequestSchema.safeParse({ ...custom, items: [] }).success, false, 'custom needs items');
  assert.equal(quoteRequestSchema.safeParse({ packageSlug: 'x', startDate: '7/11/2026', travellers: 2 }).success, false);
  assert.equal(quoteRequestSchema.safeParse({ packageSlug: 'x', startDate: '2026-11-07', travellers: 2, totalKes: 1 }).success, false, 'client cannot send a price');
});

test('hold requests normalise the phone number', () => {
  const r = holdRequestSchema.parse({ quoteId: '00000000-0000-4000-8000-000000000001', phone: '0712 345 678' });
  assert.equal(r.phone, '254712345678');
});
