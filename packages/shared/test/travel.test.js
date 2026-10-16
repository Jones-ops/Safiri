const test = require('node:test');
const assert = require('node:assert/strict');
const { tripReminders, eatToIso } = require('../src/travel');

const trip = (items) => ({
  bookingId: 'b1',
  startDate: '2026-11-07',
  days: [{ date: '2026-11-07', items }, { date: '2026-11-08', items: [{ time: '10:00', title: 'Boat ride' }] }],
});

test('EAT times become exact instants', () => {
  assert.equal(eatToIso('2026-11-07', '07:00'), '2026-11-07T04:00:00.000Z');
  assert.equal(eatToIso('2026-11-07', '01:30'), '2026-11-06T22:30:00.000Z', 'early EAT is the previous UTC day');
});

test('evening before at 19:00, and an hour before the first timed item', () => {
  const r = tripReminders(trip([{ time: '12:00', title: 'Lodge check-in' }, { time: '07:00', title: 'Shuttle' }]), new Date('2026-11-01T00:00:00Z'));
  assert.deepEqual(r.map((x) => [x.kind, x.at, x.first.title]), [
    ['evening_before', '2026-11-06T16:00:00.000Z', 'Shuttle'],
    ['morning_of', '2026-11-07T03:00:00.000Z', 'Shuttle'],
  ]);
});

test('never before 05:00; 07:00 when nothing has a time', () => {
  assert.equal(tripReminders(trip([{ time: '05:30', title: 'Van' }]), new Date('2026-11-01T00:00:00Z'))[1].at, eatToIso('2026-11-07', '05:00'));
  const untimed = tripReminders(trip([{ time: null, title: 'Stay' }]), new Date('2026-11-01T00:00:00Z'));
  assert.equal(untimed[1].at, eatToIso('2026-11-07', '07:00'));
  assert.equal(untimed[1].first.title, 'Stay');
});

test('reminders already past are left out', () => {
  const r = tripReminders(trip([{ time: '07:00', title: 'Shuttle' }]), new Date('2026-11-06T17:00:00Z'));
  assert.deepEqual(r.map((x) => x.kind), ['morning_of']);
  assert.deepEqual(tripReminders(trip([]), new Date('2026-11-08T00:00:00Z')), []);
});
