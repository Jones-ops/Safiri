/** Sentry must start before anything else is loaded so it can instrument it. */
const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false, // phone numbers are personal data under the Data Protection Act
  });
}
