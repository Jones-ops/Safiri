import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { formatKes } from '../lib/format';
import { AppText } from './AppText';
import { StatusLabel, statusText } from './StatusLabel';

/** A friend's share in a group split. status: paid | not_paid | pending | overdue */
export function MemberPaidChip({ name, shareKes, status }) {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const paid = status === 'paid';
  return (
    <View
      accessible
      accessibilityLabel={`${name}, ${formatKes(shareKes)}, ${statusText(status, t)}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        minHeight: 48,
        borderRadius: radius.card,
        backgroundColor: paid ? c.primarySoft : c.surface,
        borderWidth: 1,
        borderColor: paid ? c.primarySoft : c.divider,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: c.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppText variant="label" tone="onPrimary">
          {(name || '?').trim().charAt(0).toUpperCase()}
        </AppText>
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="body" numberOfLines={1}>
          {name}
        </AppText>
        <AppText variant="caption" tone="textMuted" tabular>
          {formatKes(shareKes)}
        </AppText>
      </View>
      <StatusLabel status={status} />
    </View>
  );
}
