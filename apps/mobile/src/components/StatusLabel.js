import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

/** Status is always shown as icon + word, never colour alone. */
const STATUS = {
  paid: { icon: 'checkmark-circle', tone: 'success', key: 'status.paid' },
  due: { icon: 'time-outline', tone: 'textMuted', key: 'status.due' },
  due_soon: { icon: 'alert-circle-outline', tone: 'warning', key: 'status.dueSoon' },
  overdue: { icon: 'warning', tone: 'danger', key: 'status.overdue' },
  pending: { icon: 'hourglass-outline', tone: 'textMuted', key: 'status.pending' },
  failed: { icon: 'close-circle', tone: 'danger', key: 'status.failed' },
  not_paid: { icon: 'ellipse-outline', tone: 'textMuted', key: 'status.notPaid' },
  removed: { icon: 'person-remove-outline', tone: 'textMuted', key: 'status.removed' }, // organiser covered their share
};

export const STATUS_KEYS = Object.keys(STATUS);

export function StatusLabel({ status }) {
  const { c, space } = useTheme();
  const { t } = useTranslation();
  const s = STATUS[status] || STATUS.pending;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Ionicons name={s.icon} size={16} color={c[s.tone]} accessibilityElementsHidden importantForAccessibility="no" />
      <AppText variant="label" tone={s.tone}>
        {t(s.key)}
      </AppText>
    </View>
  );
}

export function statusText(status, t) {
  return t((STATUS[status] || STATUS.pending).key);
}
