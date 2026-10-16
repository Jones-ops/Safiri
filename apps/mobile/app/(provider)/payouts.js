/** Payouts: what each business is owed, what is being paid now, and the M-PESA payout history. */
import { RefreshControl, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { AppText, EmptyState, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatDate, formatKes, formatMsisdn } from '../../src/lib/format';
import { useProviderPayouts } from '../../src/features/provider/api';
import { NoListings, useListings } from '../../src/features/provider/ListingPicker';

const STATUS_ICON = { paid: ['checkmark-circle', 'success'], processing: ['hourglass-outline', 'warning'], scheduled: ['time-outline', 'textMuted'], failed: ['close-circle', 'danger'] };

export default function Payouts() {
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { providers, listings } = useListings();
  const payouts = useProviderPayouts();

  if (providers.data && !listings.length) return <NoListings />;
  if (payouts.isPending) return <View style={{ padding: space.xl, gap: space.lg }}><Skeleton variant="block" height={120} /></View>;
  if (payouts.isError) return <EmptyState icon="cloud-offline-outline" tone="danger" title={t('errors.network')} action={{ label: t('common.retry'), onPress: () => payouts.refetch() }} />;
  const { providers: balances, history } = payouts.data;

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} refreshControl={<RefreshControl refreshing={payouts.isRefetching} onRefresh={() => payouts.refetch()} />}>
      {balances.map((p) => (
        <View key={p.id} style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface, gap: space.xs }}>
          <AppText variant="heading">{p.name}</AppText>
          <AppText variant="display" tabular tone="primary">{formatKes(p.owedKes)}</AppText>
          <AppText variant="caption" tone="textMuted">{t('provider.owed')}{p.inFlightKes ? ` · ${t('provider.inFlight')}: ${formatKes(p.inFlightKes)}` : ''}</AppText>
          <AppText variant="caption" tone="textMuted">{t('provider.nextPayout', { phone: formatMsisdn(p.payoutPhone) })}</AppText>
        </View>
      ))}

      <AppText variant="heading" accessibilityRole="header">{t('provider.payoutHistory')}</AppText>
      {!history.length ? <AppText variant="body" tone="textMuted">{t('provider.noPayouts')}</AppText> : history.map((h) => {
        const [icon, tone] = STATUS_ICON[h.status] || STATUS_ICON.scheduled;
        return (
          <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.divider }}>
            <Ionicons name={icon} size={20} color={c[tone]} />
            <View style={{ flex: 1 }}>
              <AppText variant="body" tabular>{formatKes(h.amountKes)}</AppText>
              <AppText variant="caption" tone="textMuted">{formatDate((h.paidAt || h.createdAt).slice(0, 10), lang)}{h.receipt ? ` · ${h.receipt}` : ''}</AppText>
              {h.status === 'failed' ? <AppText variant="caption" tone="danger">{t('provider.payoutFailed')}</AppText> : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
