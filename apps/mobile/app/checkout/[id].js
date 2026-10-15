/**
 * Checkout: choose deposit or pay in full (amounts and dates come from the server), confirm
 * the M-PESA number, see the refund terms, and pay. The M-PESA sheet follows the payment live:
 * sending -> check your phone -> paid (-> receipt) / failed / timed out (retry or change number).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { FUNNEL, msisdnSchema, refundLines } from '@safiri/shared';
import { AppText, Button, EmptyState, MpesaPromptSheet, PhoneInput, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCountdown, formatDate, formatKes } from '../../src/lib/format';
import { useSession } from '../../src/features/auth/session';
import { track } from '../../src/analytics';
import { SETTLED, useBooking, usePayment, useStartPayment } from '../../src/features/pay/api';

// Error codes from POST /v1/payments that have their own message (checkout.errors.*).
const KNOWN_ERRORS = ['payment_in_progress', 'hold_expired', 'mpesa_unavailable', 'mpesa_not_configured', 'deposit_not_available', 'amount_over_limit', 'not_payable'];
const SHEET_STATUS = { initiated: 'sending', pending: 'waiting', succeeded: 'paid', failed: 'failed', cancelled: 'failed', timed_out: 'timed_out' };

function OptionCard({ selected, title, hint, onPress, disabled, children }) {
  const { c, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${title}. ${hint}`}
      style={{
        padding: space.lg,
        gap: space.sm,
        borderRadius: radius.card,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.primary : c.inputBorder,
        backgroundColor: c.surface,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? c.primary : c.inputBorder} />
        <AppText variant="heading" style={{ flex: 1 }}>{title}</AppText>
      </View>
      <AppText variant="body" tone="textMuted">{hint}</AppText>
      {children}
    </Pressable>
  );
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Checkout() {
  const { id } = useLocalSearchParams();
  const { c, space } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useSession();
  const now = useNow();

  const booking = useBooking(id);
  const start = useStartPayment();
  const [option, setOption] = useState(null);
  const [phone, setPhone] = useState('');
  const [paymentId, setPaymentId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState(null);
  const payment = usePayment(id, paymentId);

  const b = booking.data;
  const options = useMemo(() => b?.options || [], [b]);
  // Default: the deposit when it's offered and within M-PESA's limit, otherwise pay in full.
  useEffect(() => {
    if (option || !options.length) return;
    const deposit = options.find((o) => o.option === 'deposit' && !o.overLimit);
    setOption(deposit ? 'deposit' : 'full');
  }, [options, option]);
  useEffect(() => {
    if (!phone && session?.user.phone) setPhone(`0${session.user.phone.replace(/^\+?254/, '')}`);
  }, [session, phone]);

  // Paid: record the funnel step once, show "Paid" for a moment, then the receipt.
  const status = payment.data?.status;
  const paidTracked = useRef(false);
  useEffect(() => {
    if (status !== 'succeeded') return undefined;
    if (!paidTracked.current) {
      paidTracked.current = true;
      track(FUNNEL.PAID, { amountKes: payment.data.amountKes, option });
    }
    const timer = setTimeout(() => router.replace(`/receipt/${id}`), 1200);
    return () => clearTimeout(timer);
  }, [status, payment.data, option, id]);

  // Reopened after paying: go straight to the receipt. A split booking is paid on its group screen.
  const bookingStatus = booking.data?.status;
  const isGroup = booking.data?.isGroup;
  useEffect(() => {
    if (isGroup) router.replace(`/group/${id}`);
    else if (bookingStatus === 'confirmed' || bookingStatus === 'fully_paid') router.replace(`/receipt/${id}`);
  }, [bookingStatus, isGroup, id]);

  if (booking.isPending) {
    return (
      <View style={{ padding: space.xl, gap: space.lg }}>
        <Stack.Screen options={{ title: t('checkout.title') }} />
        <Skeleton variant="block" height={120} />
        <Skeleton variant="block" height={120} />
      </View>
    );
  }
  if (!b) {
    return <EmptyState icon="help-circle-outline" title={t('hold.notFound')} action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }} />;
  }
  if (b.isGroup || b.status === 'confirmed' || b.status === 'fully_paid') return null; // the effect above moves on to the receipt
  if (b.status !== 'held') {
    return <EmptyState icon="time-outline" title={t('hold.expiredTitle')} body={t('hold.expiredBody')} action={{ label: t('hold.startAgain'), onPress: () => router.replace(b.packageSlug ? `/p/${b.packageSlug}` : '/explore') }} />;
  }

  const selected = options.find((o) => o.option === option);
  const deposit = options.find((o) => o.option === 'deposit');
  const full = options.find((o) => o.option === 'full');
  const msLeft = b.holdExpiresAt ? new Date(b.holdExpiresAt).getTime() - now : 0;
  const parsedPhone = msisdnSchema.safeParse(phone);

  const pay = () => {
    setError(null);
    setPaymentId(null);
    setSheetOpen(true);
    start.mutate(
      { bookingId: id, option, phone: parsedPhone.data },
      {
        onSuccess: (r) => {
          setPaymentId(r.paymentId);
          track(FUNNEL.STK_SENT, { amountKes: r.amountKes, option });
        },
        onError: (err) => {
          setSheetOpen(false);
          setError(KNOWN_ERRORS.includes(err.code) ? `checkout.errors.${err.code}` : err.offline ? 'errors.network' : 'errors.generic');
          if (err.code === 'hold_expired') booking.refetch();
        },
      },
    );
  };

  const sheetStatus = start.isPending || !paymentId ? 'sending' : SHEET_STATUS[status] || 'waiting';

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t('checkout.title') }} />
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ionicons name="time-outline" size={18} color={msLeft < 120000 ? c.danger : c.primary} />
          <AppText variant="label" tone={msLeft < 120000 ? 'danger' : 'primary'} tabular>
            {t('checkout.heldFor', { time: formatCountdown(msLeft) })}
          </AppText>
        </View>

        <View style={{ gap: space.xs }}>
          <AppText variant="title" accessibilityRole="header">{b.title || t('builder.title')}</AppText>
          <AppText variant="body" tone="textMuted">
            {t('hold.dates', { from: formatDate(b.startDate, lang), to: formatDate(b.endDate, lang) })} · {t('builder.totalFor', { n: b.travellers, amount: formatKes(b.totalKes) })}
          </AppText>
        </View>

        <AppText variant="heading" accessibilityRole="header">{t('checkout.howToPay')}</AppText>
        <View accessibilityRole="radiogroup" style={{ gap: space.md }}>
          {deposit ? (
            <OptionCard
              selected={option === 'deposit'}
              disabled={deposit.overLimit}
              onPress={() => setOption('deposit')}
              title={t('checkout.payDeposit')}
              hint={deposit.schedule.length - 1 === 1
                ? t('checkout.payDepositHintOne', { amount: formatKes(deposit.amountKes) })
                : t('checkout.payDepositHint', { amount: formatKes(deposit.amountKes), n: deposit.schedule.length - 1 })}
            >
              {option === 'deposit' ? (
                <View style={{ gap: space.xs, marginTop: space.xs }}>
                  {deposit.schedule.map((p) => (
                    <View key={p.seq} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <AppText variant="label" tone="textMuted">{p.seq === 0 ? t('checkout.today') : formatDate(p.dueDate, lang)}</AppText>
                      <AppText variant="label" tabular>{formatKes(p.amountKes)}</AppText>
                    </View>
                  ))}
                </View>
              ) : null}
            </OptionCard>
          ) : null}
          {full ? (
            <OptionCard selected={option === 'full'} disabled={full.overLimit} onPress={() => setOption('full')}
              title={t('checkout.payFull')} hint={full.overLimit ? t('checkout.overLimit') : t('checkout.payFullHint', { amount: formatKes(full.amountKes) })} />
          ) : null}
        </View>

        <PhoneInput value={phone} onChange={setPhone} label={t('checkout.mpesaNumber')} error={phone && !parsedPhone.success ? 'errors.phone.invalid' : null} />

        {b.travellers > 1 ? (
          <Button label={t('price.splitWithFriends')} variant="secondary" icon="people-outline" onPress={() => router.push(`/group/${id}`)} />
        ) : null}

        <View style={{ gap: space.xs }}>
          <AppText variant="heading" accessibilityRole="header">{t('checkout.policy')}</AppText>
          {refundLines(b.cancelPolicy, t).map((line) => (
            <AppText key={line} variant="label" tone="textMuted">• {line}</AppText>
          ))}
        </View>

        {error ? <AppText variant="label" tone="danger" accessibilityLiveRegion="assertive">{t(error)}</AppText> : null}

        <Button
          label={selected ? t('checkout.pay', { amount: formatKes(selected.amountKes) }) : t('common.loading')}
          icon="phone-portrait-outline"
          onPress={pay}
          disabled={!selected || selected.overLimit || !parsedPhone.success || msLeft <= 0}
          loading={start.isPending}
        />
      </ScrollView>

      <MpesaPromptSheet
        visible={sheetOpen}
        phone={parsedPhone.data || phone}
        amountKes={selected?.amountKes || 0}
        status={sheetStatus}
        onRetry={pay}
        onChangeNumber={() => setSheetOpen(false)}
        onClose={() => {
          if (SETTLED.includes(status) || !paymentId) setSheetOpen(false);
        }}
      />
    </View>
  );
}
