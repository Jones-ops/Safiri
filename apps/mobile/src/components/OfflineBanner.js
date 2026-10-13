import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { timeAgo } from '../lib/format';
import { AppText } from './AppText';

/**
 * savedAt set: "Available offline, saved 2 hours ago" (itinerary, cached lists).
 * offline with no savedAt: "You're offline. Showing what's saved on your phone."
 */
export function OfflineBanner({ savedAt, offline = false }) {
  const { c, space } = useTheme();
  const { t } = useTranslation();
  if (!savedAt && !offline) return null;
  const text = savedAt ? t('offline.savedAgo', { time: timeAgo(savedAt, t) }) : t('offline.youAreOffline');

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: offline ? c.text : c.primarySoft,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
      }}
    >
      <Ionicons
        name={offline ? 'cloud-offline-outline' : 'download-outline'}
        size={16}
        color={offline ? c.bg : c.primary}
      />
      <AppText variant="label" tone={offline ? c.bg : c.primary} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}
