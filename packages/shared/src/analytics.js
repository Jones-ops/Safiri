/**
 * Funnel event names. One list so the app, the API and PostHog dashboards use the same words.
 * Order matters: it is the booking funnel from the build plan.
 */
const FUNNEL = Object.freeze({
  VIEW_PACKAGE: 'package_viewed',
  OPEN_BUILDER: 'builder_opened',
  START_CHECKOUT: 'checkout_started',
  STK_SENT: 'stk_sent',
  PAID: 'payment_succeeded',
});

const EVENTS = Object.freeze({
  ...FUNNEL,
  APP_OPENED: 'app_opened',
  WELCOME_COMPLETED: 'welcome_completed',
  OTP_REQUESTED: 'otp_requested',
  SIGNED_IN: 'signed_in',
  LANGUAGE_CHANGED: 'language_changed',
  LOW_DATA_CHANGED: 'low_data_changed',
});

module.exports = { FUNNEL, EVENTS };
