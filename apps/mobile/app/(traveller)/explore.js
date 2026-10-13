/**
 * Explore. Slice 0 proves the read path end to end: destinations come from Supabase with the
 * publishable key under RLS, are cached on the phone, and still show offline. Packages,
 * search and filters arrive in Slice 1.
 */
import { ScrollView, View, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AppText, EmptyState, OfflineBanner, PhotoBackground, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { isSupabaseConfigured, supabase } from '../../src/lib/supabase';
import { useIsOnline } from '../../src/lib/network';
import { useSettings } from '../../src/state/settings';
import { bundledPhotos } from '../../src/assets/photos';

async function fetchDestinations() {
  const { data, error } = await supabase.from('destinations').select('id, slug, name, region').order('name');
  if (error) throw error;
  return data;
}

export default function Explore() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const lowData = useSettings((s) => s.lowData);
  const destinations = useQuery({ queryKey: ['destinations'], queryFn: fetchDestinations, enabled: isSupabaseConfigured });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        <PhotoBackground source={bundledPhotos.explore} lowData={lowData} style={{ paddingTop: insets.top + space.xl, paddingBottom: space.xl }}>
          <View style={{ paddingHorizontal: space.xl, gap: space.xs }}>
            <AppText variant="label" tone="#FFFFFF" style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
              Safiri
            </AppText>
            <AppText variant="title" tone="#FFFFFF" accessibilityRole="header">
              {t('explore.title')}
            </AppText>
          </View>
        </PhotoBackground>

        <OfflineBanner offline={!online} />

        <View style={{ padding: space.xl, gap: space.md }}>
          <AppText variant="heading">{t('explore.destinations')}</AppText>

          {!isSupabaseConfigured ? (
            <EmptyState icon="construct-outline" title={t('errors.generic')} body={t('common.notConfigured')} />
          ) : destinations.isPending ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} width={96} height={40} />
              ))}
            </View>
          ) : destinations.isError && !destinations.data ? (
            <EmptyState
              icon="cloud-offline-outline"
              tone="danger"
              title={t('explore.couldNotLoad')}
              body={online ? t('errors.generic') : t('errors.network')}
              action={{ label: t('common.retry'), onPress: () => destinations.refetch() }}
            />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {destinations.data.map((d) => (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.name}, ${d.region}`}
                  style={{
                    minHeight: 48,
                    paddingHorizontal: space.lg,
                    justifyContent: 'center',
                    borderRadius: radius.chip,
                    backgroundColor: c.primarySoft,
                  }}
                >
                  <AppText variant="label" tone="primary">
                    {d.name}
                  </AppText>
                </Pressable>
              ))}
            </View>
          )}

          <EmptyState title={t('explore.emptyTitle')} body={t('explore.emptyBody')} />
        </View>
      </ScrollView>
    </View>
  );
}
