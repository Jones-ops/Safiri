import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { formatKes, formatMsisdn } from '../lib/format';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * Shown while an M-Pesa STK push is in progress.
 * status: sending | waiting | paid | failed | timed_out
 */
const VIEW = {
  sending: { icon: null, titleKey: 'mpesa.sending', tone: 'text' },
  waiting: { icon: 'phone-portrait-outline', titleKey: 'mpesa.checkPhone', tone: 'primary' },
  paid: { icon: 'checkmark-circle', titleKey: 'mpesa.paid', tone: 'success' },
  failed: { icon: 'close-circle', titleKey: 'mpesa.failed', tone: 'danger' },
  timed_out: { icon: 'time-outline', titleKey: 'mpesa.timedOut', tone: 'warning' },
};

export function MpesaPromptSheet({ visible, phone, amountKes, status, onRetry, onChangeNumber, onClose }) {
  const { c, radius, space, elevation, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const v = VIEW[status] || VIEW.waiting;
  const done = status === 'paid';
  const stuck = status === 'failed' || status === 'timed_out';

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={done || stuck ? onClose : undefined} accessible={false} />
      <View
        accessibilityViewIsModal
        style={[
          {
            backgroundColor: c.surface,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            padding: space.xl,
            paddingBottom: space.xl + insets.bottom,
            gap: space.lg,
            alignItems: 'center',
          },
          elevation.sheet,
        ]}
      >
        <AppText variant="caption" tone="textMuted">
          {t('mpesa.amount')}
        </AppText>
        <AppText variant="display" tabular>
          {formatKes(amountKes)}
        </AppText>
        <View style={{ height: 56, justifyContent: 'center' }}>
          {v.icon ? <Ionicons name={v.icon} size={48} color={c[v.tone]} /> : <ActivityIndicator size="large" color={c.primary} />}
        </View>
        <AppText variant="heading" tone={v.tone} style={{ textAlign: 'center' }} accessibilityLiveRegion="assertive">
          {t(v.titleKey, { phone: formatMsisdn(phone) })}
        </AppText>
        {status === 'waiting' ? (
          <AppText variant="body" tone="textMuted" style={{ textAlign: 'center' }}>
            {formatMsisdn(phone)}
          </AppText>
        ) : null}
        {stuck ? (
          <View style={{ alignSelf: 'stretch', gap: space.sm }}>
            <Button label={t('common.retry')} onPress={onRetry} />
            <Button label={t('mpesa.changeNumber')} variant="ghost" onPress={onChangeNumber} />
          </View>
        ) : null}
        {done ? <Button label={t('common.continue')} onPress={onClose} style={{ alignSelf: 'stretch' }} /> : null}
      </View>
    </Modal>
  );
}
