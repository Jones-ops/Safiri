import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { formatDate, formatKes } from '../lib/format';
import { AppText } from './AppText';
import { StatusLabel, statusText } from './StatusLabel';

/** One payment in a plan: label, amount, due date and status. status: paid | due | due_soon | overdue | pending | failed */
export function PaymentStatusRow({ label, amountKes, dueDate, status }) {
  const { c, space } = useTheme();
  const { t, i18n } = useTranslation();
  const date = dueDate ? formatDate(dueDate, i18n.language) : null;
  return (
    <View
      accessible
      accessibilityLabel={[label, formatKes(amountKes), date, statusText(status, t)].filter(Boolean).join(', ')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderBottomColor: c.divider,
        gap: space.md,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body">{label}</AppText>
        {date ? (
          <AppText variant="caption" tone="textMuted">
            {date}
          </AppText>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <AppText variant="body" tabular style={{ fontWeight: '600' }}>
          {formatKes(amountKes)}
        </AppText>
        <StatusLabel status={status} />
      </View>
    </View>
  );
}
