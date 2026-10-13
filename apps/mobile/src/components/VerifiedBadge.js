import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { formatDate } from '../lib/format';
import { AppText } from './AppText';

/** "Verified" with the licence number; tap to see who verified it and when. */
export function VerifiedBadge({ licenceNo, verifiedAt, verifiedBy = 'Safiri' }) {
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${t('trust.verified')}, ${t('trust.licence', { number: licenceNo })}`}
      style={{ alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center' }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          backgroundColor: c.primarySoft,
          borderRadius: radius.chip,
          paddingHorizontal: space.md,
          paddingVertical: space.xs,
        }}
      >
        <Ionicons name="shield-checkmark" size={16} color={c.primary} />
        <AppText variant="label" tone="primary">
          {t('trust.verified')}
        </AppText>
      </View>
      {open ? (
        <View style={{ paddingTop: space.sm, paddingHorizontal: space.xs }}>
          <AppText variant="caption" tone="textMuted">
            {t('trust.licence', { number: licenceNo })}
          </AppText>
          {verifiedAt ? (
            <AppText variant="caption" tone="textMuted">
              {verifiedBy} · {formatDate(verifiedAt, i18n.language)}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
