/**
 * Travel day without signal. As soon as a trip is confirmed (and whenever it is opened online),
 * its itinerary is saved on the phone and the day-of reminders are scheduled as LOCAL
 * notifications, which fire in airplane mode. Offline, the saved itinerary is shown instead.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { tripReminders } from '@safiri/shared';
import { api } from '../../lib/api';
import { tripStore } from '../../lib/storage';
import { useSettings } from '../../state/settings';
import { holdTokens } from '../build/api';

const itineraryKey = (id) => `itinerary:${id}`;
const remindersKey = (id) => `reminders:${id}`;

export function loadSavedItinerary(bookingId) {
  try {
    const raw = tripStore.getString(itineraryKey(bookingId));
    return raw ? JSON.parse(raw) : null; // { itinerary, savedAt }
  } catch {
    return null;
  }
}

function saveItinerary(bookingId, itinerary) {
  const entry = { itinerary, savedAt: new Date().toISOString() };
  tripStore.set(itineraryKey(bookingId), JSON.stringify(entry));
  return entry;
}

/** The itinerary: fresh when online (and saved), the saved copy when not. */
export function useItinerary(bookingId, { enabled = true } = {}) {
  const saved = bookingId ? loadSavedItinerary(bookingId) : null;
  return useQuery({
    queryKey: ['itinerary', bookingId],
    enabled: enabled && Boolean(bookingId),
    networkMode: 'always', // run offline too, so we can fall back to the saved copy
    staleTime: 60 * 1000,
    initialData: saved ? { ...saved, fresh: false } : undefined,
    initialDataUpdatedAt: saved ? Date.parse(saved.savedAt) : undefined,
    queryFn: async () => {
      try {
        const token = holdTokens.get(bookingId);
        const itinerary = await api(`/v1/bookings/${bookingId}/itinerary${token ? `?token=${encodeURIComponent(token)}` : ''}`);
        return { ...saveItinerary(bookingId, itinerary), fresh: true };
      } catch (err) {
        const fallback = loadSavedItinerary(bookingId);
        if (fallback) return { ...fallback, fresh: false };
        throw err;
      }
    },
  });
}

/**
 * Schedules the evening-before and morning-of reminders on the phone. Re-runs are cheap: if
 * the times haven't changed nothing is touched; a cancelled trip clears its reminders.
 */
export function useTripReminders(itinerary) {
  const { t } = useTranslation();
  const consented = useSettings((s) => s.consents.notifications);

  useEffect(() => {
    if (!itinerary) return;
    const id = itinerary.bookingId;
    const reminders = consented && itinerary.status !== 'cancelled' ? tripReminders(itinerary, new Date()) : [];
    const signature = JSON.stringify(reminders.map((r) => [r.id, r.at]));
    let previous = null;
    try {
      previous = JSON.parse(tripStore.getString(remindersKey(id)) || 'null');
    } catch {
      previous = null;
    }
    if (previous?.signature === signature) return;

    (async () => {
      for (const notificationId of previous?.ids || []) {
        await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
      }
      const ids = [];
      if (reminders.length) {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('trips', { name: t('trips.title'), importance: Notifications.AndroidImportance.HIGH });
        }
        const { status } = await Notifications.requestPermissionsAsync();
        if (status === 'granted') {
          for (const r of reminders) {
            const first = r.first
              ? r.first.time
                ? t('tripReminder.firstUp', { time: r.first.time, item: r.first.title })
                : t('tripReminder.firstUpUntimed', { item: r.first.title })
              : '';
            ids.push(await Notifications.scheduleNotificationAsync({
              content: {
                title: r.kind === 'evening_before' ? t('tripReminder.eveningTitle') : t('tripReminder.morningTitle', { title: itinerary.title }),
                body: [first, t('tripReminder.offlineNote')].filter(Boolean).join(' '),
                data: { url: `/trip/${id}` },
              },
              trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.at), channelId: 'trips' },
            }));
          }
        }
      }
      tripStore.set(remindersKey(id), JSON.stringify({ signature, ids }));
    })().catch(() => {}); // reminders are a nice-to-have on top of the saved itinerary
  }, [itinerary, consented, t]);
}
