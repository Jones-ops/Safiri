const test = require('node:test');
const assert = require('node:assert/strict');
const { priceBreakdown, paymentSchedule, formatKes, formatAmount } = require('../src/money');

test('worked example from the build plan: 2-night Naivasha weekend', () => {
  const price = priceBreakdown({
    items: [
      { label: 'Lodge', netKes: 4500, qty: 2 },
      { label: 'Return shuttle', netKes: 2500, qty: 1 },
      { label: 'Boat ride', netKes: 1500, qty: 1 },
    ],
    marginBps: 1500,
    feeBps: 500,
  });
  assert.equal(price.netKes, 13000);
  assert.equal(price.marginKes, 1950);
  assert.equal(price.totalKes, 15700); // 15,697.50 rounded up to the next 50
  assert.equal(price.feeKes, 750); // 747.50 plus the 2.50 rounding
});

test('parts always add up to the traveller price', () => {
  for (let net = 1; net <= 60000; net += 137) {
    for (const marginBps of [0, 1000, 1500, 2250]) {
      const p = priceBreakdown({ items: [{ netKes: net, qty: 1 }], marginBps, feeBps: 500 });
      assert.equal(p.netKes + p.marginKes + p.feeKes, p.totalKes);
      assert.equal(p.totalKes % 50, 0);
      assert.ok(p.feeKes >= Math.floor(((net + p.marginKes) * 500) / 10000), 'fee is never below 5%');
      assert.ok(Number.isInteger(p.marginKes) && Number.isInteger(p.feeKes));
    }
  }
});

test('margin rounds half up', () => {
  // 15% of 10 = 1.5 -> 2
  assert.equal(priceBreakdown({ items: [{ netKes: 10, qty: 1 }], marginBps: 1500, feeBps: 0 }).marginKes, 2);
  // 15% of 9 = 1.35 -> 1
  assert.equal(priceBreakdown({ items: [{ netKes: 9, qty: 1 }], marginBps: 1500, feeBps: 0 }).marginKes, 1);
});

test('rejects non-integer or negative money', () => {
  assert.throws(() => priceBreakdown({ items: [{ netKes: 10.5, qty: 1 }], marginBps: 0, feeBps: 0 }));
  assert.throws(() => priceBreakdown({ items: [{ netKes: -1, qty: 1 }], marginBps: 0, feeBps: 0 }));
  assert.throws(() => priceBreakdown({ items: [], marginBps: 0, feeBps: 0 }));
});

test('plan example: 25% deposit then 3 equal instalments', () => {
  assert.deepEqual(paymentSchedule({ totalKes: 15700, depositPct: 25, instalmentCount: 3 }), {
    depositKes: 3925,
    instalments: [3925, 3925, 3925],
  });
});

test('uneven split puts the remainder on the last instalment', () => {
  const plan = paymentSchedule({ totalKes: 10050, depositPct: 25, instalmentCount: 4 });
  assert.equal(plan.depositKes, 2513); // 2512.5 rounded up
  assert.deepEqual(plan.instalments, [1884, 1884, 1884, 1885]);
  assert.equal(plan.depositKes + plan.instalments.reduce((a, b) => a + b, 0), 10050);
});

test('schedules always sum to the total', () => {
  for (let total = 50; total <= 360000; total += 1450) {
    for (const count of [0, 1, 2, 3, 5]) {
      const plan = paymentSchedule({ totalKes: total, depositPct: 25, instalmentCount: count });
      assert.equal(plan.depositKes + plan.instalments.reduce((a, b) => a + b, 0), total);
      assert.equal(plan.instalments.length, count === 0 ? 0 : count);
    }
  }
});

test('zero instalments means pay in full', () => {
  assert.deepEqual(paymentSchedule({ totalKes: 8000, depositPct: 25, instalmentCount: 0 }), {
    depositKes: 8000,
    instalments: [],
  });
});

test('formats KES the Kenyan way', () => {
  assert.equal(formatKes(15700), 'KES 15,700');
  assert.equal(formatKes(1250000), 'KES 1,250,000');
  assert.equal(formatKes(0), 'KES 0');
  assert.equal(formatAmount(3925), '3,925');
});
