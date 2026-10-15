/**
 * A group invite opened in the app (the same link works in any browser without the app):
 * who invited you, your share, and one button to pay it with M-PESA.
 */
import { Alert, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, MpesaPromptSheet, Skeleton, StatusLabel } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatDate, formatKes } from '../../src/lib/format';
import { api } from '../../src/lib/api';
import { usePayFlow } from '../../src/features/pay/usePayFlow';

const KNOWN = ['payment_in_progress', 'mpesa_unavailable', 'mpesa_not_configured', 'amount_over_limit', 'not_payable', 'hold_expired'];

export default function Invite() {
  const { code } = useLocalSearchParams();
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const invite = useQuery({
    queryKey: ['hold', 'invite', code], // never cached for offline
    queryFn: () => api(`/v1/invites/${encodeURIComponent(code)}`),
  });

  const flow = usePayFlow({
    key: code,
    start: () => api(`/v1/invites/${encodeURIComponent(code)}/pay`, { method: 'POST', body: {} }),
    status: (paymentId) => api(`/v1/invites/${encodeURIComponent(code)}/payments/${paymentId}`),
    onPaid: () => queryClient.invalidateQueries({ queryKey: ['hold', 'invite', code] }),
    onError: (err) => Alert.alert(t('invite.title'), t(KNOWN.includes(err.code) ? `checkout.errors.${err.code}` : err.offline ? 'errors.network' : 'errors.generic')),
  });

  if (invite.isPending) {
    return <View style={{ padding: space.xl }}><Stack.Screen options={{ title: t('invite.title') }} /><Skeleton variant="block" height={160} /></View>;
  }
  const i = invite.data;
  if (!i) {
    return <EmptyState icon="help-circle-outline" title={invite.error?.offline ? t('errors.network') : t('hold.notFound')} action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t('invite.title') }} />
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <AppText variant="label" tone="primary">{t('invite.from', { organiser: i.organiserName })}</AppText>
          <AppText variant="title" accessibilityRole="header">{i.title || i.ref}</AppText>
          <AppText variant="body" tone="textMuted">
            {t('hold.dates', { from: formatDate(i.startDate, i18n.language), to: formatDate(i.endDate, i18n.language) })}
          </AppText>
        </View>
        <View style={{ gap: space.sm, padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface }}>
          <AppText variant="heading">{t('web.inviteShare', { amount: formatKes(i.shareKes) })}</AppText>
          {i.paidKes ? <AppText variant="body">{t('web.invitePaidSoFar', { amount: formatKes(i.paidKes) })}</AppText> : null}
          <StatusLabel status={i.leftKes === 0 ? 'paid' : 'not_paid'} />
          {i.payable ? (
            <>
              <AppText variant="label" tone="textMuted">{t('web.payPhoneHint', { phone: i.phone })}</AppText>
              <Button label={t('checkout.pay', { amount: formatKes(i.leftKes) })} icon="phone-portrait-outline" onPress={flow.pay} loading={flow.busy} />
            </>
          ) : (
            <AppText variant="body">{i.leftKes === 0 ? t('web.inviteDone') : t('web.inviteClosed')}</AppText>
          )}
        </View>
      </ScrollView>
      <MpesaPromptSheet {...flow.sheet} phone={i.phone} />
    </View>
  );
}
