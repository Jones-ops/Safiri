/** Cancel a trip: what comes back under the policy today, then one confirming tap. */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatKes } from '../../src/lib/format';
import { useCancelPreview, useCancelTrip } from '../../src/features/account/api';

export default function CancelTrip() {
  const { id } = useLocalSearchParams();
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const preview = useCancelPreview(id);
  const cancel = useCancelTrip();
  const [done, setDone] = useState(null);

  if (preview.isPending) return <View style={{ padding: space.xl }}><Skeleton variant="block" height={160} /></View>;
  if (preview.isError || !preview.data?.cancellable) {
    return <EmptyState icon="information-circle-outline" title={t('cancel.notCancellable')} action={{ label: t('common.back'), onPress: () => router.back() }} />;
  }
  const p = preview.data;

  if (done) {
    return (
      <EmptyState
        icon="checkmark-circle-outline"
        title={done.refundKes > 0 ? t('cancel.done', { amount: formatKes(done.refundKes) }) : t('cancel.doneNoRefund')}
        action={{ label: t('trips.title'), onPress: () => router.replace('/trips') }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
      <View style={{ gap: space.xs }}>
        <AppText variant="caption" tone="textMuted">{t('hold.ref', { ref: p.ref })}</AppText>
        <AppText variant="title" accessibilityRole="header">{t('cancel.title')}</AppText>
      </View>

      <View style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface, gap: space.sm }}>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          <Ionicons name="cash-outline" size={22} color={c.primary} />
          <AppText variant="body" style={{ flex: 1 }}>
            {t('cancel.preview', { days: p.daysBefore, pct: p.refundPct, amount: formatKes(p.refundKes) })}
          </AppText>
        </View>
        {p.keptKes > 0 ? <AppText variant="caption" tone="textMuted">{t('cancel.kept', { amount: formatKes(p.keptKes) })}</AppText> : null}
      </View>

      {cancel.isError ? <AppText variant="body" tone="danger">{cancel.error.offline ? t('errors.network') : t('errors.generic')}</AppText> : null}

      <Button
        label={p.refundKes > 0 ? t('cancel.confirm', { amount: formatKes(p.refundKes) }) : t('cancel.confirmNoRefund')}
        icon="close-circle-outline"
        loading={cancel.isPending}
        onPress={() => cancel.mutate(id, { onSuccess: (r) => setDone({ refundKes: r.refundKes ?? p.refundKes }) })}
        style={{ backgroundColor: c.danger, borderColor: c.danger }}
      />
      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}
