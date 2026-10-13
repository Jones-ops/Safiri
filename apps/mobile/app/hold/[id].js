/**
 * A held booking: 15-minute countdown, booking ref, the price that was held, and release.
 * Paying the deposit with M-PESA (the checkout) is Slice 3a; until then the button explains.
 */
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, PriceTag, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCountdown, formatDate, formatKes } from '../../src/lib/format';
import { useHold, useReleaseHold } from '../../src/features/build/api';

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export default function Hold() {
  const { id } = useLocalSearchParams();
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const hold = useHold(id);
  const release = useReleaseHold();
  const h = hold.data;
  const now = useNow(h?.status === 'held');

  if (hold.isPending) {
    return (
      <View style={{ padding: space.xl, gap: space.lg }}>
        <Stack.Screen options={{ title: '' }} />
        <Skeleton width="60%" height={28} />
        <Skeleton variant="block" height={120} />
      </View>
    );
  }
  if (!h) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="help-circle-outline" title={hold.error?.offline ? t('errors.network') : t('hold.notFound')}
          action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }} />
      </>
    );
  }

  const msLeft = h.holdExpiresAt ? new Date(h.holdExpiresAt).getTime() - now : 0;
  const expired = h.status === 'expired' || (h.status === 'held' && msLeft <= 0);
  const released = h.status === 'cancelled';
  const startAgain = () => router.replace(h.packageSlug ? `/p/${h.packageSlug}` : '/explore');

  if (expired || released) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState
          icon={released ? 'checkmark-circle-outline' : 'time-outline'}
          title={released ? t('hold.released') : t('hold.expiredTitle')}
          body={released ? null : t('hold.expiredBody')}
          action={{ label: t('hold.startAgain'), onPress: startAgain }}
        />
      </>
    );
  }

  const onRelease = () =>
    release.mutate(id, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hold', id] }),
      onError: () => Alert.alert(t('hold.release'), t('errors.generic')),
    });

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
      <Stack.Screen options={{ title: t('hold.title'), headerBackVisible: false }} />
      <View style={{ alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.card, backgroundColor: c.primarySoft }}>
        <Ionicons name="time-outline" size={32} color={c.primary} />
        <AppText variant="display" tone="primary" tabular accessibilityLabel={t('hold.timeLeft', { time: formatCountdown(msLeft) })}>
          {formatCountdown(msLeft)}
        </AppText>
        <AppText variant="body" style={{ textAlign: 'center' }}>{t('hold.body')}</AppText>
      </View>

      <View style={{ gap: space.xs }}>
        <AppText variant="caption" tone="textMuted">{t('hold.ref', { ref: h.ref })}</AppText>
        <AppText variant="title" accessibilityRole="header">{h.title || h.destinationName}</AppText>
        <AppText variant="body" tone="textMuted">
          {t('hold.dates', { from: formatDate(h.startDate, i18n.language), to: formatDate(h.endDate, i18n.language) })}
        </AppText>
      </View>

      {h.perPersonKes ? <PriceTag totalKes={h.perPersonKes} /> : null}
      <AppText variant="body" tabular style={{ fontWeight: '600' }}>
        {h.travellers === 1 ? t('builder.totalForOne', { amount: formatKes(h.totalKes) }) : t('builder.totalFor', { n: h.travellers, amount: formatKes(h.totalKes) })}
      </AppText>

      <Button label={t('hold.pay', { amount: formatKes(h.totalKes) })} icon="phone-portrait-outline"
        onPress={() => Alert.alert(t('hold.title'), t('hold.payNextUpdate'))} />
      <Button label={t('hold.release')} variant="ghost" onPress={onRelease} loading={release.isPending} />
    </ScrollView>
  );
}
