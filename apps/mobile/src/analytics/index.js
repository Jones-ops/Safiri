/**
 * PostHog, only after the user ticks the analytics consent (Data Protection Act). Before that,
 * and when no key is set, every call is a no-op. Users are identified by their account id,
 * never their phone number. Event names come from packages/shared (EVENTS / FUNNEL).
 */
import { PostHog } from 'posthog-react-native';
import { asStorage, settingsStore } from '../lib/storage';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

let client = null;

export function setAnalyticsConsent(granted) {
  if (granted && KEY && !client) {
    client = new PostHog(KEY, {
      host: HOST,
      customStorage: asStorage(settingsStore),
      captureAppLifecycleEvents: true,
      flushAt: 20, // batch events to save data
    });
  } else if (!granted && client) {
    client.optOut();
    client.reset();
    client = null;
  }
}

export function track(event, properties) {
  client?.capture(event, properties);
}

export function identify(userId) {
  if (userId) client?.identify(userId);
}

export function resetAnalytics() {
  client?.reset();
}
