/** Crash reporting. Starts before the app renders; does nothing without a DSN. */
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false, // no IPs or phone numbers
    tracesSampleRate: 0.1,
    enableAutoSessionTracking: true,
  });
}

export const wrapWithSentry = (Component) => (dsn ? Sentry.wrap(Component) : Component);
export { Sentry };
