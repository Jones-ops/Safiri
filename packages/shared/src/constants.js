/** Values the app, the API and the database all agree on. Keep in step with the SQL enums. */

const BOOKING_STATES = Object.freeze({
  DRAFT: 'draft',
  HELD: 'held',
  CONFIRMED: 'confirmed',
  FULLY_PAID: 'fully_paid',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
});

/** Allowed moves. Only a confirmed payment or a timer moves a booking forward. */
const BOOKING_TRANSITIONS = Object.freeze({
  draft: ['held', 'cancelled'],
  held: ['confirmed', 'expired', 'cancelled'],
  confirmed: ['fully_paid', 'cancelled'],
  fully_paid: ['completed', 'cancelled'],
  completed: [],
  expired: [],
  cancelled: [],
});

function canTransition(from, to) {
  return (BOOKING_TRANSITIONS[from] || []).includes(to);
}

const ROLES = Object.freeze({ TRAVELLER: 'traveller', PROVIDER: 'provider', AGENCY: 'agency', ADMIN: 'admin' });

/** Each consent is asked for separately, with its purpose, on the Welcome screen. */
const CONSENT_PURPOSES = Object.freeze({
  BOOKING: 'booking', // required: process bookings and payments
  NOTIFICATIONS: 'notifications', // reminders by push, WhatsApp and SMS
  ANALYTICS: 'analytics', // product analytics (PostHog); off until granted
  MARKETING: 'marketing', // offers and referrals
});
const REQUIRED_CONSENTS = Object.freeze([CONSENT_PURPOSES.BOOKING]);

/** Defaults from the build plan; every one is configurable per package or in settings. */
const DEFAULTS = Object.freeze({
  PLATFORM_FEE_BPS: 500, // 5%
  AGENCY_MARGIN_BPS: 1500, // 15%
  DEPOSIT_PCT: 25,
  INSTALMENT_COUNT: 3,
  FINAL_DUE_DAYS: 7, // final payment due this many days before travel
  HOLD_MINUTES: 15,
  MAX_BOOKING_MONTHS_AHEAD: 6,
  REMINDER_DAYS_BEFORE: [3, 1],
});

/** M-Pesa refuses a single payment above this, so larger amounts must be split. */
const MPESA_MAX_TRANSACTION_KES = 250000;

const TIMEZONE = 'Africa/Nairobi';
const LANGUAGES = Object.freeze(['en', 'sw']);

module.exports = {
  BOOKING_STATES,
  BOOKING_TRANSITIONS,
  canTransition,
  ROLES,
  CONSENT_PURPOSES,
  REQUIRED_CONSENTS,
  DEFAULTS,
  MPESA_MAX_TRANSACTION_KES,
  TIMEZONE,
  LANGUAGES,
};
