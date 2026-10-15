/**
 * A one-tap pay link opened in the app (from an SMS, WhatsApp or push reminder, or an App
 * Link). Same link works in a browser without the app (the API's web pay page).
 */
import { Alert, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, MpesaPromptSheet, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatDate, formatKes } from '../../src/lib/format';
import { api } from '../../src/lib/api';
import { usePayFlow } from '../../src/features/pay/usePayFlow';

const KNOWN = ['payment_in_progress', 'mpesa_unavailable', 'mpesa_not_configured', 'amount_over_limit', 'not_payable'];

export default function PayLink() {
  const { code } = useLocalSearchParams();
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const link = useQuery({
    queryKey: ['hold', 'pay-link', code], // never cached for offline
    queryFn: () => api(`/v1/pay-links/${encodeURIComponent(code)}`),
  });

  const flow = usePayFlow({
    key: code,
    start: () => api(`/v1/pay-links/${encodeURIComponent(code)}/pay`, { method: 'POST', body: {} }),
    status: (paymentId) => api(`/v1/pay-links/${encodeURIComponent(code)}/payments/${paymentId}`),
    onPaid: () => {
      queryClient.invalidateQueries({ queryKey: ['hold', 'pay-link', code] });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (err) => Alert.alert(t('paylink.title'), t(KNOWN.includes(err.code) ? `checkout.errors.${err.code}` : err.offline ? 'errors.network' : 'errors.generic')),
  });

  if (link.isPending) {
    return <View style={{ padding: space.xl }}><Stack.Screen options={{ title: t('paylink.title') }} /><Skeleton variant="block" height={160} /></View>;
  }
  const l = link.data;
  if (!l) {
    return <EmptyState icon="help-circle-outline" title={link.error?.offline ? t('errors.network') : t('hold.notFound')} action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t('paylink.title') }} />
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <AppText variant="caption" tone="textMuted">{t('hold.ref', { ref: l.ref })}</AppText>
          <AppText variant="title" accessibilityRole="header">{l.title}</AppText>
          <AppText variant="body" tone="textMuted">
            {t('hold.dates', { from: formatDate(l.startDate, i18n.language), to: formatDate(l.endDate, i18n.language) })}
          </AppText>
        </View>
        {l.payable ? (
          <View style={{ gap: space.md, padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface }}>
            <AppText variant="display" tabular>{formatKes(l.amountKes)}</AppText>
            <AppText variant="label" tone="textMuted">{t('web.payBalance', { amount: formatKes(l.balanceKes) })}</AppText>
            <AppText variant="label" tone="textMuted">{t('web.payPhoneHint', { phone: l.phone })}</AppText>
            <Button label={t('checkout.pay', { amount: formatKes(l.amountKes) })} icon="phone-portrait-outline" onPress={flow.pay} loading={flow.busy} />
          </View>
        ) : (
          <AppText variant="body">{l.bookingStatus === 'fully_paid' || l.bookingStatus === 'confirmed' ? t('web.payNothingDue') : t('web.payNotActive')}</AppText>
        )}
      </ScrollView>
      <MpesaPromptSheet {...flow.sheet} phone={l.phone} />
    </View>
  );
}
