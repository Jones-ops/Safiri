/**
 * Turning a trip (package or custom) into dated lines, the same way for the quote engine,
 * the seed and the app. Stays are per person per night, twin share.
 */

/**
 * items: [{ ref, unit, day, qty }]  unit: night | day | person; day is 1-based; qty is per person
 *   (nights for a stay, days for a game drive, usually 1 otherwise).
 * Returns one line per listing per date:
 *   [{ ref, dayIndex, units, perPersonQty }]
 *   dayIndex is 0-based from the start date; units is what the line takes from availability
 *   (rooms for stays, places otherwise); perPersonQty multiplies the per-unit price per person.
 */
function expandLines(items, travellers) {
  if (!Number.isInteger(travellers) || travellers < 1) throw new RangeError('travellers must be 1 or more');
  const lines = [];
  for (const { ref, unit, day, qty } of items) {
    const first = day - 1;
    if (unit === 'night' || unit === 'day') {
      // Stays: one room per two travellers. Drives: a place per traveller, each day.
      const units = unit === 'night' ? Math.ceil(travellers / 2) : travellers;
      for (let k = 0; k < qty; k++) lines.push({ ref, dayIndex: first + k, units, perPersonQty: 1 });
    } else {
      lines.push({ ref, dayIndex: first, units: travellers * qty, perPersonQty: qty });
    }
  }
  return lines;
}

/** "2026-10-17" + 2 days -> "2026-10-19" (dates are plain calendar dates, no time zone). */
function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in Kenya (EAT, UTC+3), as "YYYY-MM-DD". */
function todayInKenya(now = new Date()) {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Long drives on short trips: warn when the road takes 4 hours or more and there are fewer than 2 nights. */
function driveTimeWarning(driveHours, nights) {
  return Boolean(driveHours) && driveHours >= 4 && nights < 2;
}

/** Whole days from one calendar date to another ("2026-10-13" -> "2026-10-20" = 7). */
function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);
}

module.exports = { expandLines, addDays, daysBetween, todayInKenya, driveTimeWarning };
