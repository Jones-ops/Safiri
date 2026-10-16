/** Requests: bookings waiting for this provider to accept or decline, plus recent answers. */
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, OfflineBanner, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useIsOnline } from '../../src/lib/network';
import { formatDate, formatKes, formatTime } from '../../src/lib/format';
import { useMyProviders } from '../../src/features/account/api';
import { useProviderRequests, useRespond } from '../../src/features/provider/api';

const STATUS = {
  pending: { icon: 'hourglass-outline', tone: 'warning', key: 'provider.pending' },
  accepted: { icon: 'checkmark-circle', tone: 'success', key: 'provider.accepted' },
  declined: { icon: 'close-circle', tone: 'danger', key: 'provider.declined' },
  expired: { icon: 'time-outline', tone: 'textMuted', key: 'provider.expired' },
};

function RequestCard({ r, onRespond, busy }) {
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const s = STATUS[r.status] || STATUS.pending;
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <AppText variant="heading" style={{ flex: 1 }} numberOfLines={2}>{r.title || r.ref}</AppText>
        <AppText variant="caption" tone="textMuted">{r.ref}</AppText>
      </View>
      <AppText variant="body" tone="textMuted">{r.items.join(' · ')}</AppText>
      <AppText variant="label">
        {r.firstDate === r.lastDate ? formatDate(r.firstDate, lang) : t('hold.dates', { from: formatDate(r.firstDate, lang), to: formatDate(r.lastDate, lang) })}
        {' · '}{t('provider.guests', { n: r.travellers })}
      </AppText>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="body" tabular style={{ fontWeight: '600' }}>{t('provider.youReceive', { amount: formatKes(r.payoutKes) })}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Ionicons name={s.icon} size={16} color={c[s.tone]} />
          <AppText variant="label" tone={s.tone}>{t(s.key)}</AppText>
        </View>
      </View>
      {r.status === 'pending' ? (
        <>
          {r.respondBy ? <AppText variant="caption" tone="textMuted">{t('provider.respondBy', { time: `${formatDate(r.respondBy.slice(0, 10), lang, { withYear: false })} ${formatTime(r.respondBy)}` })}</AppText> : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label={t('provider.accept')} icon="checkmark" onPress={() => onRespond(true)} loading={busy} style={{ flex: 1 }} />
            <Button label={t('provider.decline')} icon="close" variant="secondary" onPress={() => onRespond(false)} disabled={busy} style={{ flex: 1 }} />
          </View>
        </>
      ) : null}
    </View>
  );
}

export default function Requests() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const online = useIsOnline();
  const providers = useMyProviders();
  const requests = useProviderRequests();
  const respond = useRespond();

  if (providers.data && providers.data.length === 0) {
    return <EmptyState icon="storefront-outline" title={t('modes.becomeProvider')} body={t('modes.becomeProviderHint')} action={{ label: t('onboard.title'), onPress: () => router.push('/provider/onboard') }} />;
  }
  const unverified = (providers.data || []).filter((p) => !p.verifiedAt);

  if (requests.isPending) return <View style={{ padding: space.xl, gap: space.lg }}><Skeleton variant="block" height={160} /><Skeleton variant="block" height={160} /></View>;
  const list = requests.data || [];
  const pending = list.filter((r) => r.status === 'pending');
  const rest = list.filter((r) => r.status !== 'pending');

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner offline={!online} />
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} refreshControl={<RefreshControl refreshing={requests.isRefetching} onRefresh={() => requests.refetch()} />}>
        {unverified.length ? (
          <View style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: c.primarySoft, gap: space.xs }}>
            <AppText variant="heading">{t('provider.notVerifiedTitle')}</AppText>
            <AppText variant="body" tone="textMuted">{t('provider.verifiedPending')}</AppText>
          </View>
        ) : null}
        {requests.isError ? <EmptyState icon="cloud-offline-outline" tone="danger" title={t('errors.network')} action={{ label: t('common.retry'), onPress: () => requests.refetch() }} /> : null}
        {!list.length && !requests.isError ? <EmptyState icon="notifications-outline" title={t('provider.requestsEmpty')} body={t('provider.requestsEmptyBody')} /> : null}
        {pending.map((r) => (
          <RequestCard key={r.code} r={r} busy={respond.isPending && respond.variables?.code === r.code} onRespond={(accept) => respond.mutate({ code: r.code, accept })} />
        ))}
        {rest.map((r) => <RequestCard key={r.code} r={r} onRespond={() => {}} />)}
      </ScrollView>
    </View>
  );
}
