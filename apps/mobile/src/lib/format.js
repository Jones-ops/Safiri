/**
 * Dates in Kenya time (EAT, UTC+3, no daylight saving) and the app's language. Done by hand,
 * so the output is identical on every phone regardless of its Intl support or time zone.
 */
import { formatKes, formatAmount, formatMsisdn } from '@safiri/shared';

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};

const toEat = (value) => new Date(new Date(value).getTime() + EAT_OFFSET_MS);

/** "13 Oct 2026" / "13 Okt 2026". Accepts a Date, timestamp or "YYYY-MM-DD". */
export function formatDate(value, language = 'en', { withYear = true } = {}) {
  // A plain date ("2026-10-13") has no time zone; don't shift it.
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : toEat(value);
  const months = MONTHS[language] || MONTHS.en;
  const base = `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  return withYear ? `${base} ${d.getUTCFullYear()}` : base;
}

/** "14:05" in EAT (Kenyans use the 24-hour clock in writing as often as 12-hour; 24h avoids am/pm confusion). */
export function formatTime(value) {
  const d = toEat(value);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Relative time with explicit singular/plural keys (no reliance on Intl.PluralRules). */
export function timeAgo(value, t, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t(minutes === 1 ? 'time.minuteAgo' : 'time.minutesAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t(hours === 1 ? 'time.hourAgo' : 'time.hoursAgo', { n: hours });
  const days = Math.round(hours / 24);
  return t(days === 1 ? 'time.dayAgo' : 'time.daysAgo', { n: days });
}

export { formatKes, formatAmount, formatMsisdn };
