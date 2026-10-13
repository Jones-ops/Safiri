import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { formatAmount } from '../lib/format';
import { AppText } from './AppText';

/** Amber fill with dark text (amber never carries text on its own). */
export function InstalmentBadge({ count, amountKes }) {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const label = `${t('price.payInInstalments')}: ${count} x ${formatAmount(amountKes)}`;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: c.accent,
        borderRadius: radius.chip,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
      }}
    >
      <Ionicons name="calendar-outline" size={14} color={c.onAccent} style={{ marginRight: space.xs }} />
      <AppText variant="label" tone={c.onAccent} tabular>
        {count} x {formatAmount(amountKes)}
      </AppText>
    </View>
  );
}
