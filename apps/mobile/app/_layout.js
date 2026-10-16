import '../src/lib/sentry'; // first, so crashes during start-up are caught
import '../src/i18n';
import '../src/lib/network';
import { useEffect, useRef } from 'react';
import { router, Stack, usePathname, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useTranslation } from 'react-i18next';
import { EVENTS } from '@safiri/shared';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { queryClient, persistOptions } from '../src/lib/queryClient';
import { SessionProvider, useSession } from '../src/features/auth/session';
import { useSettings } from '../src/state/settings';
import { setAnalyticsConsent, track } from '../src/analytics';
import { wrapWithSentry } from '../src/lib/sentry';
import { usePushNotifications } from '../src/features/notifications/push';
import { usePendingReviewFlush } from '../src/features/review/queue';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Open without signing in: first-run setup, sign-in itself, legal pages, and the invite and pay
// links friends receive (they pay a share by M-PESA without an account).
const OPEN_ROUTES = new Set(['welcome', 'sign-in', 'verify', 'privacy', 'credits', 'i', 'pay']);
const AUTH_ROUTES = new Set(['sign-in', 'verify']);

/** The app needs an account: signed out, every other screen goes to sign-in (Welcome first, once). */
function useSignInGate() {
  const { session, ready } = useSession();
  const welcomeDone = useSettings((s) => s.welcomeDone);
  const segments = useSegments();
  const pathname = usePathname();
  const next = useRef(null); // the screen a signed-out user opened, shown after sign-in

  useEffect(() => {
    if (!ready) return;
    const first = segments[0];
    if (!session) {
      if (OPEN_ROUTES.has(first)) return;
      if (pathname && pathname !== '/' && pathname !== '/explore') next.current = pathname;
      router.replace(welcomeDone ? '/sign-in' : '/welcome');
    } else if (AUTH_ROUTES.has(first)) {
      const to = next.current || '/explore';
      next.current = null;
      router.replace(to);
    }
  }, [ready, session, welcomeDone, segments, pathname]);

  return ready;
}

function RootStack() {
  const { c, scheme, reduceMotion } = useTheme();
  const { t } = useTranslation();
  usePushNotifications();
  usePendingReviewFlush();
  const ready = useSignInGate();

  useEffect(() => {
    // Analytics starts only if the user agreed on the Welcome screen.
    setAnalyticsConsent(useSettings.getState().consents.analytics);
    track(EVENTS.APP_OPENED);
  }, []);

  useEffect(() => {
    // Keep the splash up until we know whether the user is signed in, so no screen flashes first.
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.bg },
          animation: reduceMotion ? 'none' : 'default',
        }}
      >
        <Stack.Screen name="(traveller)" options={{ headerShown: false }} />
        <Stack.Screen name="(provider)" options={{ headerShown: false }} />
        <Stack.Screen name="(agency)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: t('auth.emailTitle') }} />
        <Stack.Screen name="verify" options={{ title: t('auth.otpTitle') }} />
        <Stack.Screen name="privacy" options={{ title: t('privacy.title') }} />
        <Stack.Screen name="credits" options={{ title: t('credits.title') }} />
        <Stack.Screen name="design-system" options={{ title: t('designSystem.title') }} />
        <Stack.Screen name="p/[slug]" options={{ title: '' }} />
        <Stack.Screen name="d/[slug]" options={{ title: '' }} />
        <Stack.Screen name="builder" options={{ title: t('builder.title') }} />
        <Stack.Screen name="hold/[id]" options={{ title: t('hold.title'), gestureEnabled: false }} />
        <Stack.Screen name="checkout/[id]" options={{ title: t('checkout.title') }} />
        <Stack.Screen name="receipt/[id]" options={{ title: '', gestureEnabled: false }} />
        <Stack.Screen name="pay/[code]" options={{ title: t('paylink.title') }} />
        <Stack.Screen name="group/[id]" options={{ title: t('group.title') }} />
        <Stack.Screen name="i/[code]" options={{ title: t('invite.title') }} />
        <Stack.Screen name="trip/[id]" options={{ title: t('trip.itinerary') }} />
        <Stack.Screen name="cancel/[id]" options={{ title: t('cancel.title') }} />
        <Stack.Screen name="review/[id]" options={{ title: t('review.title') }} />
        <Stack.Screen name="referral" options={{ title: t('review.referralTitle', { amount: 500 }) }} />
        <Stack.Screen name="provider/onboard" options={{ title: t('onboard.title') }} />
        <Stack.Screen name="agency/package/[id]" options={{ title: t('agency.editor') }} />
      </Stack>
    </>
  );
}

function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <SessionProvider>
            <RootStack />
          </SessionProvider>
        </PersistQueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default wrapWithSentry(RootLayout);
