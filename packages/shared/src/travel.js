/**
 * Travel day: when the phone should remind the traveller (scheduled as local notifications
 * the moment the itinerary is saved, so they fire with no signal), and emergency numbers.
 * All times are Kenya time (EAT, UTC+3, no daylight saving).
 */

/** "2026-11-07" + "06:30" in EAT -> the exact instant, as an ISO string in UTC. */
function eatToIso(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 3, mm)).toISOString();
}

const pad = (n) => String(n).padStart(2, '0');
const minus = (time, minutes) => {
  const [h, m] = time.split(':').map(Number);
  const total = Math.max(0, h * 60 + m - minutes);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

const EVENING_BEFORE = '19:00';
const EARLIEST_MORNING = '05:00';
const DEFAULT_MORNING = '07:00';

/**
 * @param {{ bookingId: string, startDate: string, days: { date: string, items: { time: string|null, title: string }[] }[] }} trip
 * @param {Date} now
 * @returns {{ id: string, at: string, kind: 'evening_before'|'morning_of', first: { time: string|null, title: string }|null }[]}
 *   Reminders still in the future: the evening before at 19:00, and on the morning of travel an
 *   hour before the first timed item (never before 05:00; 07:00 when nothing has a time).
 */
function tripReminders(trip, now = new Date()) {
  const firstDay = trip.days.find((d) => d.date === trip.startDate) || trip.days[0];
  const items = firstDay?.items || [];
  const timed = items.filter((i) => i.time).sort((a, b) => a.time.localeCompare(b.time));
  const first = timed[0] || items[0] || null;
  const morning = timed[0] ? minus(timed[0].time, 60) : DEFAULT_MORNING;
  const prevDay = new Date(`${trip.startDate}T00:00:00Z`);
  prevDay.setUTCDate(prevDay.getUTCDate() - 1);

  return [
    { id: `${trip.bookingId}:evening_before`, kind: 'evening_before', at: eatToIso(prevDay.toISOString().slice(0, 10), EVENING_BEFORE), first },
    { id: `${trip.bookingId}:morning_of`, kind: 'morning_of', at: eatToIso(trip.startDate, morning < EARLIEST_MORNING ? EARLIEST_MORNING : morning), first },
  ].filter((r) => new Date(r.at) > now);
}

/** Emergency numbers that work anywhere in Kenya, on any network, even without credit. */
const EMERGENCY_NUMBERS = Object.freeze([
  { key: 'police', phone: '999' },
  { key: 'emergency', phone: '112' },
]);

module.exports = { tripReminders, eatToIso, EMERGENCY_NUMBERS };
