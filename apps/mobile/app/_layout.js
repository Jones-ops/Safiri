import '../src/lib/sentry'; // first, so crashes during start-up are caught
import '../src/i18n';
import '../src/lib/network';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useTranslation } from 'react-i18next';
import { EVENTS } from '@safiri/shared';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { queryClient, persistOptions } from '../src/lib/queryClient';
import { SessionProvider } from '../src/features/auth/session';
import { useSettings } from '../src/state/settings';
import { setAnalyticsConsent, track } from '../src/analytics';
import { wrapWithSentry } from '../src/lib/sentry';
import { usePushNotifications } from '../src/features/notifications/push';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const { c, scheme, reduceMotion } = useTheme();
  const { t } = useTranslation();
  usePushNotifications();

  useEffect(() => {
    // Analytics starts only if the user agreed on the Welcome screen.
    setAnalyticsConsent(useSettings.getState().consents.analytics);
    track(EVENTS.APP_OPENED);
    SplashScreen.hideAsync().catch(() => {});
  }, []);

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
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: t('auth.phoneTitle') }} />
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
