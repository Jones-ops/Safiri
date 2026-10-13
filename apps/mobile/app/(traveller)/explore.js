/**
 * Explore: search, destination chips, budget and pay-monthly filters, and the package list.
 * Data comes from the phone's cache first, so it opens instantly and works offline.
 * Dates and group size arrive with the trip builder (Slice 2), where availability is checked.
 */
import { useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { instalmentPreview } from '@safiri/shared';
import { AppText, Chip, EmptyState, ListRow, OfflineBanner, PackageCard, PhotoBackground, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { maxFontScale, touchTarget } from '../../src/theme/tokens';
import { isSupabaseConfigured } from '../../src/lib/supabase';
import { useIsOnline } from '../../src/lib/network';
import { formatKes } from '../../src/lib/format';
import { photoSource } from '../../src/lib/photos';
import { useSettings } from '../../src/state/settings';
import { bundledPhotos } from '../../src/assets/photos';
import { localised, useDestinations, usePackages } from '../../src/features/catalogue/queries';

const BUDGETS = [null, 10000, 20000, 35000];

export default function Explore() {
  const { c, radius, space, type } = useTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const lowData = useSettings((s) => s.lowData);
  const packages = usePackages();
  const destinations = useDestinations();

  const [search, setSearch] = useState('');
  const [destination, setDestination] = useState(null);
  const [budget, setBudget] = useState(null);
  const [payMonthly, setPayMonthly] = useState(false);
  const filtered = Boolean(search || destination || budget || payMonthly);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (packages.data || []).filter((p) => {
      if (destination && p.destination.slug !== destination) return false;
      if (budget && p.fromPriceKes > budget) return false;
      if (payMonthly && !p.instalments) return false;
      if (!q) return true;
      return [localised(p, 'title', i18n.language), p.destination.name, localised(p, 'summary', i18n.language)]
        .some((text) => text?.toLowerCase().includes(q));
    });
  }, [packages.data, search, destination, budget, payMonthly, i18n.language]);

  const clearFilters = () => {
    setSearch('');
    setDestination(null);
    setBudget(null);
    setPayMonthly(false);
  };

  const selectedDestination = destinations.data?.find((d) => d.slug === destination);

  const header = (
    <View>
      <PhotoBackground source={bundledPhotos.explore} lowData={lowData} style={{ paddingTop: insets.top + space.xl, paddingBottom: space.xl }}>
        <View style={{ paddingHorizontal: space.xl, gap: space.md }}>
          <AppText variant="label" tone="#FFFFFF" style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
            Safiri
          </AppText>
          <AppText variant="title" tone="#FFFFFF" accessibilityRole="header">
            {t('explore.title')}
          </AppText>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              minHeight: touchTarget,
              paddingHorizontal: space.md,
              borderRadius: radius.input,
              backgroundColor: c.surface,
            }}
          >
            <Ionicons name="search" size={20} color={c.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('explore.searchPlaceholder')}
              placeholderTextColor={c.textMuted}
              accessibilityLabel={t('explore.searchPlaceholder')}
              returnKeyType="search"
              maxFontSizeMultiplier={maxFontScale}
              style={[type.body, { flex: 1, color: c.text, paddingVertical: space.sm }]}
            />
          </View>
        </View>
      </PhotoBackground>

      <OfflineBanner offline={!online} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, padding: space.lg, paddingBottom: space.sm }}>
        <Chip label={t('explore.all')} selected={!destination} onPress={() => setDestination(null)} />
        {(destinations.data || []).map((d) => (
          <Chip key={d.slug} label={d.name} selected={destination === d.slug} onPress={() => setDestination(destination === d.slug ? null : d.slug)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <Chip label={t('explore.payMonthly')} icon="calendar-outline" selected={payMonthly} onPress={() => setPayMonthly((v) => !v)} />
        {BUDGETS.map((b) => (
          <Chip
            key={String(b)}
            label={b ? t('explore.budgetUpTo', { amount: formatKes(b) }) : t('explore.budgetAny')}
            selected={budget === b}
            onPress={() => setBudget(b)}
          />
        ))}
      </ScrollView>

      {selectedDestination ? (
        <View style={{ paddingHorizontal: space.lg }}>
          <ListRow icon="information-circle-outline" label={selectedDestination.name} value={selectedDestination.region} onPress={() => router.push(`/d/${selectedDestination.slug}`)} />
        </View>
      ) : null}

      {packages.data ? (
        <AppText variant="caption" tone="textMuted" style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }}>
          {t('explore.resultsCount', { n: results.length })}
        </AppText>
      ) : null}
    </View>
  );

  let empty;
  if (!isSupabaseConfigured) {
    empty = <EmptyState icon="construct-outline" title={t('errors.generic')} body={t('common.notConfigured')} />;
  } else if (packages.isPending) {
    empty = (
      <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </View>
    );
  } else if (packages.isError && !packages.data) {
    empty = (
      <EmptyState
        icon="cloud-offline-outline"
        tone="danger"
        title={t('explore.couldNotLoad')}
        body={online ? t('errors.generic') : t('errors.network')}
        action={{ label: t('common.retry'), onPress: () => packages.refetch() }}
      />
    );
  } else if (filtered) {
    empty = (
      <EmptyState
        icon="search-outline"
        title={t('explore.noResultsTitle')}
        body={t('explore.noResultsBody')}
        action={{ label: t('explore.clearFilters'), onPress: clearFilters }}
      />
    );
  } else {
    empty = <EmptyState title={t('explore.emptyTitle')} body={t('explore.emptyBody')} />;
  }

  return (
    <FlashList
      data={results}
      keyExtractor={(p) => p.slug}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={{ paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
      onRefresh={() => {
        packages.refetch();
        destinations.refetch();
      }}
      refreshing={packages.isRefetching}
      renderItem={({ item }) => {
        const preview = instalmentPreview({ totalKes: item.fromPriceKes, depositPct: item.depositPct, instalmentCount: item.instalments });
        return (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
            <PackageCard
              pkg={{
                title: localised(item, 'title', i18n.language),
                destinationName: item.destination.name,
                nights: item.nights,
                fromPriceKes: item.fromPriceKes,
                instalments: preview ? { times: preview.times, amountKes: preview.amountKes } : null,
              }}
              posterSource={photoSource(item.heroImage, { lowData: true })}
              lowData={lowData}
              onPress={() => router.push(`/p/${item.slug}`)}
            />
          </View>
        );
      }}
    />
  );
}
