/**
 * Success / receipt: booking ref, what was paid with the M-PESA receipt codes, the payment
 * plan and the next due date. Guests are offered an account (phone OTP) so the trip follows
 * them to any phone; it can be skipped. Signing in with the booking's phone claims it.
 */
import { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, PaymentStatusRow, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatDate, formatKes } from '../../src/lib/format';
import { useSession } from '../../src/features/auth/session';
import { useBooking, useClaimBooking } from '../../src/features/pay/api';

const ROW_STATUS = { paid: 'paid', due: 'due', overdue: 'overdue', cancelled: 'failed', waived: 'paid' };

export default function Receipt() {
  const { id } = useLocalSearchParams();
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useSession();
  const queryClient = useQueryClient();
  const booking = useBooking(id);
  const claim = useClaimBooking();
  const b = booking.data;

  // Came back from signing in: attach this booking to the account (same phone only).
  const claimTried = useRef(false);
  useEffect(() => {
    if (!session || !b || b.claimed || claimTried.current) return;
    claimTried.current = true;
    claim.mutate(id, { onSettled: () => queryClient.invalidateQueries({ queryKey: ['hold', id, 'summary'] }) });
  }, [session, b, id, claim, queryClient]);

  if (booking.isPending) {
    return (
      <View style={{ padding: space.xl, gap: space.lg }}>
        <Stack.Screen options={{ title: '' }} />
        <Skeleton variant="block" height={140} />
        <Skeleton width="70%" />
      </View>
    );
  }
  if (!b) return <EmptyState icon="help-circle-outline" title={t('hold.notFound')} action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }} />;

  const refundDue = !['confirmed', 'fully_paid', 'completed'].includes(b.status) && b.payments.length > 0;
  const fullyPaid = b.status === 'fully_paid';

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }}>
      <Stack.Screen options={{ title: '', headerBackVisible: false }} />

      <View style={{ alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.card, backgroundColor: refundDue ? c.surface : c.primarySoft }}>
        <Ionicons name={refundDue ? 'return-down-back-outline' : 'checkmark-circle'} size={48} color={refundDue ? c.warning : c.success} />
        <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {refundDue ? t('mpesa.failed') : fullyPaid ? t('receipt.fullyPaid') : t('receipt.title')}
        </AppText>
        <AppText variant="label" tone="textMuted">{t('receipt.ref', { ref: b.ref })}</AppText>
      </View>

      {refundDue ? <AppText variant="body">{t('receipt.refundDue')}</AppText> : null}

      <View style={{ gap: space.xs }}>
        <AppText variant="heading">{b.title || t('builder.title')}</AppText>
        <AppText variant="body" tone="textMuted">
          {t('hold.dates', { from: formatDate(b.startDate, lang), to: formatDate(b.endDate, lang) })}
        </AppText>
      </View>

      {b.payments.map((p) => (
        <View key={p.id} style={{ gap: 2 }}>
          <AppText variant="body" tabular style={{ fontWeight: '600' }}>{t('receipt.paid', { amount: formatKes(p.amountKes) })}</AppText>
          {p.receipt ? <AppText variant="label" tone="textMuted">{t('receipt.mpesaReceipt', { code: p.receipt })}</AppText> : null}
        </View>
      ))}

      {!refundDue && b.instalments.length > 1 ? (
        <View>
          <AppText variant="heading" accessibilityRole="header">{t('checkout.schedule')}</AppText>
          {b.instalments.map((i) => (
            <PaymentStatusRow key={i.seq} label={i.seq === 0 ? t('pkg.deposit') : t('pkg.instalmentN', { n: i.seq })}
              amountKes={i.amountKes} dueDate={i.dueDate} status={ROW_STATUS[i.status] || 'due'} />
          ))}
        </View>
      ) : null}

      {!refundDue ? (
        <AppText variant="body" style={{ fontWeight: '600' }}>
          {b.nextPayment
            ? t('receipt.next', { amount: formatKes(b.nextPayment.amountKes), date: formatDate(b.nextPayment.dueDate, lang) })
            : t('receipt.nothingMore')}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="textMuted">{t('receipt.smsSent')}</AppText>

      {b.claimed ? (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <Ionicons name="person-circle-outline" size={20} color={c.success} />
          <AppText variant="label" tone="success">{t('receipt.saved')}</AppText>
        </View>
      ) : !session ? (
        <View style={{ gap: space.sm, padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface }}>
          <AppText variant="heading">{t('receipt.saveAccount')}</AppText>
          <AppText variant="body" tone="textMuted">{t('receipt.saveAccountHint')}</AppText>
          <Button label={t('profile.signIn')} icon="call-outline" onPress={() => router.push('/sign-in')} />
        </View>
      ) : null}

      <Button label={t('receipt.done')} variant={b.claimed || session ? 'primary' : 'ghost'} onPress={() => router.navigate('/explore')} />
    </ScrollView>
  );
}
