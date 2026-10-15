const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSchedule } = require('../src/schedule');

const base = { totalKes: 15700, depositPct: 25, instalmentCount: 3, finalDueDays: 7, today: '2026-10-13' };

test('plenty of time: deposit today, three instalments ending 7 days before travel', () => {
  const s = buildSchedule({ ...base, startDate: '2027-01-20' });
  assert.equal(s.payInFullOnly, false);
  assert.equal(s.finalDueDate, '2027-01-13');
  assert.deepEqual(s.payments.map((p) => p.amountKes), [3925, 3925, 3925, 3925]);
  assert.equal(s.payments[0].dueDate, '2026-10-13');
  assert.equal(s.payments.at(-1).dueDate, '2027-01-13');
});

test('booked close to travel: fewer instalments, at least a week apart', () => {
  const s = buildSchedule({ ...base, startDate: '2026-11-03' }); // final due 27 Oct, 14 days away
  assert.equal(s.payments.length, 3, 'deposit + 2 instalments');
  assert.deepEqual(s.payments.map((p) => p.dueDate), ['2026-10-13', '2026-10-20', '2026-10-27']);
  assert.equal(s.payments.reduce((a, p) => a + p.amountKes, 0), 15700);
});

test('inside a week of the final due date: pay in full', () => {
  for (const startDate of ['2026-10-24', '2026-10-15', '2026-10-14']) {
    const s = buildSchedule({ ...base, startDate });
    assert.equal(s.payInFullOnly, true, startDate);
    assert.deepEqual(s.payments, [{ seq: 0, amountKes: 15700, dueDate: '2026-10-13' }]);
  }
});

test('pay-in-full packages stay pay-in-full', () => {
  assert.equal(buildSchedule({ ...base, instalmentCount: 0, startDate: '2027-03-01' }).payInFullOnly, true);
});

test('every schedule adds up to the total', () => {
  for (let days = 1; days < 200; days += 3) {
    const startDate = new Date(Date.UTC(2026, 9, 13 + days)).toISOString().slice(0, 10);
    const s = buildSchedule({ ...base, totalKes: 52551, startDate });
    assert.equal(s.payments.reduce((a, p) => a + p.amountKes, 0), 52551, startDate);
    const dates = s.payments.map((p) => p.dueDate);
    assert.deepEqual([...dates].sort(), dates, 'due dates in order');
  }
});
