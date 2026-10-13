/** Destination: hero photo, best time to go, getting there from Nairobi, its trips, FAQ. */
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { instalmentPreview } from '@safiri/shared';
import { AppText, EmptyState, FaqItem, OfflineBanner, PackageCard, PhotoBackground, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useIsOnline } from '../../src/lib/network';
import { photoSource } from '../../src/lib/photos';
import { useSettings } from '../../src/state/settings';
import { localised, useDestination, usePackages } from '../../src/features/catalogue/queries';

export default function Destination() {
  const { slug } = useLocalSearchParams();
  const { space } = useTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const lowData = useSettings((s) => s.lowData);
  const destination = useDestination(slug);
  const packages = usePackages();
  const lang = i18n.language;
  const d = destination.data;

  if (destination.isPending) {
    return (
      <View style={{ padding: space.xl, paddingTop: insets.top + space.xxxl, gap: space.lg }}>
        <Stack.Screen options={{ title: '' }} />
        <Skeleton variant="block" height={200} />
        <Skeleton width="60%" height={24} />
        <Skeleton width="90%" />
      </View>
    );
  }
  if (!d) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState
          icon={destination.isError ? 'cloud-offline-outline' : 'map-outline'}
          title={destination.isError ? t('errors.network') : t('destination.notFound')}
          action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }}
        />
      </>
    );
  }

  const trips = (packages.data || []).filter((p) => p.destination.slug === d.slug);
  const faq = localised(d, 'faq', lang) || [];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: space.xxxl }}>
      <Stack.Screen options={{ title: '', headerTransparent: true, headerTintColor: '#FFFFFF' }} />
      <PhotoBackground source={photoSource(d.heroImage, { hero: true, lowData })} lowData={lowData} style={{ paddingTop: insets.top + 96, paddingBottom: space.xl }}>
        <View style={{ paddingHorizontal: space.xl, gap: space.xs }}>
          <AppText variant="caption" tone="#FFFFFF">
            {d.region}
          </AppText>
          <AppText variant="display" tone="#FFFFFF" accessibilityRole="header">
            {d.name}
          </AppText>
          <AppText variant="body" tone="#FFFFFF">
            {localised(d, 'summary', lang)}
          </AppText>
        </View>
      </PhotoBackground>
      <OfflineBanner offline={!online} />

      <View style={{ padding: space.xl, gap: space.md }}>
        <AppText variant="heading" accessibilityRole="header">{t('destination.bestTime')}</AppText>
        <AppText variant="body">{localised(d, 'bestTime', lang)}</AppText>
        <AppText variant="heading" accessibilityRole="header" style={{ marginTop: space.md }}>{t('destination.gettingThere')}</AppText>
        <AppText variant="body">{localised(d, 'gettingThere', lang)}</AppText>

        <AppText variant="title" accessibilityRole="header" style={{ marginTop: space.xl }}>
          {t('destination.packages', { name: d.name })}
        </AppText>
        {trips.length ? (
          trips.map((p) => {
            const preview = instalmentPreview({ totalKes: p.fromPriceKes, depositPct: p.depositPct, instalmentCount: p.instalments });
            return (
              <PackageCard
                key={p.slug}
                pkg={{
                  title: localised(p, 'title', lang),
                  destinationName: d.name,
                  nights: p.nights,
                  fromPriceKes: p.fromPriceKes,
                  instalments: preview ? { times: preview.times, amountKes: preview.amountKes } : null,
                }}
                posterSource={photoSource(p.heroImage, { lowData: true })}
                lowData={lowData}
                onPress={() => router.push(`/p/${p.slug}`)}
              />
            );
          })
        ) : (
          <AppText variant="body" tone="textMuted">{t('destination.noPackages')}</AppText>
        )}

        {faq.length ? (
          <>
            <AppText variant="title" accessibilityRole="header" style={{ marginTop: space.xl }}>{t('destination.faq')}</AppText>
            {faq.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}
