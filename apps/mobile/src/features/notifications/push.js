/**
 * Push notifications for payment reminders. Registered only when the traveller is signed in
 * AND ticked the reminders consent on Welcome. Tapping a reminder opens its pay link.
 * (Expo push tokens need an EAS project id, so this works in EAS builds, not bare local runs.)
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useSettings } from '../../state/settings';
import { useSession } from '../auth/session';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** https://<site>/pay/<code> -> /pay/<code> inside the app. */
function routeFor(url) {
  const match = /\/pay\/([A-Za-z0-9_.-]+)/.exec(String(url || ''));
  return match ? `/pay/${match[1]}` : null;
}

export function usePushNotifications() {
  const { session } = useSession();
  const consented = useSettings((s) => s.consents.notifications);
  const { t } = useTranslation();

  useEffect(() => {
    if (!session || !consented) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return; // local builds without EAS: SMS reminders still arrive
    (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('payments', {
          name: t('notifications.channelName'),
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;
      const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
      await api('/v1/me/push-tokens', { method: 'POST', body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
    })().catch(() => {}); // reminders still go by SMS
  }, [session, consented, t]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeFor(response.notification.request.content.data?.url);
      if (route) router.push(route);
    });
    return () => sub.remove();
  }, []);
}
