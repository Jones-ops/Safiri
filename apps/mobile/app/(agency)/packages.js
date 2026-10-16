/** Packages: every trip this agency sells (admins: all), with publish state and a "from" price. */
import { RefreshControl, ScrollView, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatKes } from '../../src/lib/format';
import { useManagedPackages } from '../../src/features/agency/api';
import { useStaff } from '../../src/features/account/api';

const STATUS = { draft: ['create-outline', 'textMuted'], published: ['checkmark-circle', 'success'], unpublished: ['eye-off-outline', 'warning'] };

export default function Packages() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const staff = useStaff();
  const packages = useManagedPackages();

  if (staff.data && !staff.data.admin && !staff.data.agencies?.length) {
    return <EmptyState icon="lock-closed-outline" title={t('errors.forbidden')} action={{ label: t('modes.switch'), onPress: () => router.replace('/profile') }} />;
  }
  if (packages.isPending) return <View style={{ padding: space.xl, gap: space.lg }}><Skeleton variant="block" height={120} /><Skeleton variant="block" height={120} /></View>;
  if (packages.isError) return <EmptyState icon="cloud-offline-outline" tone="danger" title={t('errors.network')} action={{ label: t('common.retry'), onPress: () => packages.refetch() }} />;
  const list = packages.data;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 96 }} refreshControl={<RefreshControl refreshing={packages.isRefetching} onRefresh={() => packages.refetch()} />}>
        {!list.length ? <EmptyState icon="briefcase-outline" title={t('agency.noPackages')} body={t('agency.noPackagesBody')} /> : null}
        {list.map((p) => {
          const [icon, tone] = STATUS[p.status] || STATUS.draft;
          return (
            <Pressable key={p.id} onPress={() => router.push(`/agency/package/${p.id}`)} accessibilityRole="button" style={{ backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <AppText variant="heading" style={{ flex: 1 }} numberOfLines={2}>{p.title}</AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                  <Ionicons name={icon} size={16} color={c[tone]} />
                  <AppText variant="label" tone={tone}>{t(`agency.${p.status}`)}</AppText>
                </View>
              </View>
              <AppText variant="caption" tone="textMuted">{p.destinationName} · {p.nights} {t('agency.nights').toLowerCase()}{p.agencyName ? ` · ${p.agencyName}` : ''}</AppText>
              <AppText variant="body" tabular>{p.fromPriceKes ? `${formatKes(p.fromPriceKes)} ${t('common.perPerson')}` : t('agency.unpriceable')}</AppText>
              {p.bookings !== undefined ? <AppText variant="caption" tone="textMuted">{t('tabs.bookings')}: {p.bookings}</AppText> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ position: 'absolute', left: space.xl, right: space.xl, bottom: space.lg }}>
        <Button label={t('agency.newPackage')} icon="add" onPress={() => router.push('/agency/package/new')} />
      </View>
    </View>
  );
}
