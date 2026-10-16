/** Providers linked to this agency (admins: all), with verify / unverify for admins. */
import { RefreshControl, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, Skeleton, VerifiedBadge } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatMsisdn } from '../../src/lib/format';
import { useStaff } from '../../src/features/account/api';
import { useAgencyProviders, useVerifyProvider } from '../../src/features/agency/api';

export default function Providers() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const staff = useStaff();
  const providers = useAgencyProviders();
  const verify = useVerifyProvider();

  if (providers.isPending) return <View style={{ padding: space.xl, gap: space.lg }}><Skeleton variant="block" height={120} /></View>;
  if (providers.isError) return <EmptyState icon="cloud-offline-outline" tone="danger" title={t('errors.network')} action={{ label: t('common.retry'), onPress: () => providers.refetch() }} />;
  const list = providers.data;

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }} refreshControl={<RefreshControl refreshing={providers.isRefetching} onRefresh={() => providers.refetch()} />}>
      {!list.length ? <EmptyState icon="people-outline" title={t('agency.providersEmpty')} body={t('agency.providersEmptyBody')} /> : null}
      {list.map((p) => (
        <View key={p.id} style={{ backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
            <AppText variant="heading" style={{ flex: 1 }}>{p.name}</AppText>
            {p.verifiedAt ? <VerifiedBadge licenceNo={p.licenceNo} verifiedAt={p.verifiedAt} /> : <AppText variant="label" tone="warning">{t('agency.unverified')}</AppText>}
          </View>
          <AppText variant="caption" tone="textMuted">
            {t(`provider.types.${p.type}`)}{p.destination ? ` · ${p.destination}` : ''} · {p.listings} {t('provider.listing').toLowerCase()}{p.licenceNo ? ` · ${p.licenceNo}` : ''}
          </AppText>
          {p.phone ? <AppText variant="caption" tone="textMuted">{formatMsisdn(p.phone)}</AppText> : null}
          {staff.data?.admin ? (
            <Button
              label={p.verifiedAt ? t('agency.unverify') : t('agency.verify')}
              icon={p.verifiedAt ? 'close-circle-outline' : 'shield-checkmark-outline'}
              variant={p.verifiedAt ? 'ghost' : 'secondary'}
              loading={verify.isPending && verify.variables?.providerId === p.id}
              onPress={() => verify.mutate({ providerId: p.id, verified: !p.verifiedAt })}
            />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}
