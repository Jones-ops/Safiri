/** Bookings on this agency's packages, with the ones needing a provider swap first. */
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { AppText, Chip, EmptyState, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatDate, formatKes, formatMsisdn } from '../../src/lib/format';
import { useManagedBookings } from '../../src/features/agency/api';

export default function Bookings() {
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bookings = useManagedBookings();
  const [filter, setFilter] = useState('all');

  if (bookings.isPending) return <View style={{ padding: space.xl, gap: space.lg }}><Skeleton variant="block" height={120} /><Skeleton variant="block" height={120} /></View>;
  if (bookings.isError) return <EmptyState icon="cloud-offline-outline" tone="danger" title={t('errors.network')} action={{ label: t('common.retry'), onPress: () => bookings.refetch() }} />;
  const all = bookings.data;
  const list = filter === 'attention' ? all.filter((b) => b.providerDeclined > 0 || b.providerPending > 0) : all;

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }} refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => bookings.refetch()} />}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Chip label={t('agency.all')} selected={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label={t('agency.attention')} selected={filter === 'attention'} onPress={() => setFilter('attention')} icon="alert-circle-outline" />
      </View>
      {!list.length ? <EmptyState icon="list-outline" title={t('agency.bookingsEmpty')} /> : null}
      {list.map((b) => (
        <View key={b.bookingId} style={{ backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
            <AppText variant="heading" style={{ flex: 1 }} numberOfLines={2}>{b.title}</AppText>
            <AppText variant="caption" tone="textMuted">{b.ref}</AppText>
          </View>
          <AppText variant="label" tone="textMuted">
            {t('hold.dates', { from: formatDate(b.startDate, lang), to: formatDate(b.endDate, lang) })} · {t('provider.guests', { n: b.travellers })}{b.isGroup ? ` · ${t('agency.group')}` : ''}
          </AppText>
          <AppText variant="body" tabular>{t('trips.progress', { paid: formatKes(b.paidKes), total: formatKes(b.totalKes) })} · {t(`trips.status.${b.status}`, { defaultValue: b.status })}</AppText>
          <AppText variant="caption" tone="textMuted">{formatMsisdn(b.phone)}</AppText>
          {b.providerDeclined > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Ionicons name="alert-circle" size={16} color={c.danger} />
              <AppText variant="label" tone="danger">{t('agency.providerDeclined')}</AppText>
            </View>
          ) : b.providerPending > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Ionicons name="hourglass-outline" size={16} color={c.warning} />
              <AppText variant="label" tone="warning">{t('agency.providerPending')}</AppText>
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}
