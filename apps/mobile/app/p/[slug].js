/**
 * Package detail: price first (with instalments), day-by-day plan, inclusions, how you can
 * pay, refund terms, verified providers, reviews and FAQ, with Book fixed at the bottom.
 * Refund terms and licences are shown before any payment ("trust is visible").
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FUNNEL, instalmentPreview, refundLines } from '@safiri/shared';
import {
  AppText,
  Button,
  DayPlanItem,
  EmptyState,
  FaqItem,
  InstalmentBadge,
  OfflineBanner,
  PhotoBackground,
  PriceTag,
  Skeleton,
  StickyPriceBar,
  VerifiedBadge,
} from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useIsOnline } from '../../src/lib/network';
import { formatDate, formatKes } from '../../src/lib/format';
import { photoSource, webUrl } from '../../src/lib/photos';
import { settingsStore } from '../../src/lib/storage';
import { useSettings } from '../../src/state/settings';
import { track } from '../../src/analytics';
import { localised, usePackage } from '../../src/features/catalogue/queries';

/** Remembers the last price shown for a package, to warn when it changes. */
function usePriceChange(slug, priceKes) {
  const [previous, setPrevious] = useState(null);
  useEffect(() => {
    if (!priceKes) return;
    const key = `seen-price:${slug}`;
    const seen = Number(settingsStore.getString(key));
    if (seen && seen !== priceKes) setPrevious(seen);
    settingsStore.set(key, String(priceKes));
  }, [slug, priceKes]);
  return previous;
}

function Section({ title, children }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm, marginTop: space.xl }}>
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function Bullet({ icon, tone, children }) {
  const { c, space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={c[tone]} style={{ marginTop: 3 }} />
      <AppText variant="body" style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

export default function PackageDetail() {
  const { slug } = useLocalSearchParams();
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const lowData = useSettings((s) => s.lowData);
  const query = usePackage(slug);
  const pkg = query.data;
  const lang = i18n.language;
  const previousPrice = usePriceChange(slug, pkg?.fromPriceKes);

  // Funnel step 1, once per package (not again when the cached data refreshes).
  const tracked = useRef(null);
  useEffect(() => {
    if (!pkg || tracked.current === pkg.slug) return;
    tracked.current = pkg.slug;
    track(FUNNEL.VIEW_PACKAGE, { slug: pkg.slug, destination: pkg.destination.slug, priceKes: pkg.fromPriceKes });
  }, [pkg]);

  const preview = useMemo(
    () => (pkg ? instalmentPreview({ totalKes: pkg.fromPriceKes, depositPct: pkg.depositPct, instalmentCount: pkg.instalments }) : null),
    [pkg],
  );
  const providers = useMemo(
    () => (pkg ? [...new Map(pkg.items.map((i) => [i.provider.name, i.provider])).values()] : []),
    [pkg],
  );

  if (query.isPending) {
    return (
      <View style={{ padding: space.xl, paddingTop: insets.top + space.xxxl, gap: space.lg }}>
        <Stack.Screen options={{ title: '' }} />
        <Skeleton variant="block" height={220} />
        <Skeleton width="80%" height={24} />
        <Skeleton width="50%" height={32} />
        <Skeleton width="90%" />
      </View>
    );
  }
  if (!pkg) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState
          icon={query.isError ? 'cloud-offline-outline' : 'map-outline'}
          title={query.isError ? t('errors.network') : t('pkg.notFound')}
          action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }}
        />
      </>
    );
  }

  const title = localised(pkg, 'title', lang);
  const nights = pkg.nights === 0 ? t('pkg.dayTrip') : pkg.nights === 1 ? t('pkg.oneNight') : t('pkg.nights', { n: pkg.nights });
  const rating = pkg.reviews.length ? Math.round((pkg.reviews.reduce((s, r) => s + r.rating, 0) / pkg.reviews.length) * 10) / 10 : null;
  const faq = localised(pkg.destination, 'faq', lang) || [];
  const shareUrl = webUrl(`/p/${pkg.slug}`);

  const onShare = () =>
    Share.share({ message: t('pkg.shareMessage', { title, price: formatKes(pkg.fromPriceKes), url: shareUrl || '' }) }).catch(() => {});

  // Booking (quote, 15-minute hold, M-PESA) is Slice 2 and 3a.
  const onBook = () => Alert.alert(t('pkg.book'), t('pkg.bookingOpensSoon'));

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: '',
          headerTransparent: true,
          headerTintColor: '#FFFFFF',
          headerRight: () => (
            <Button label={t('pkg.share')} variant="ghost" icon="share-social-outline" onPress={onShare} style={{ borderColor: 'transparent' }} />
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxxl }}>
        <PhotoBackground source={photoSource(pkg.heroImage, { hero: true, lowData })} lowData={lowData} style={{ paddingTop: insets.top + 120, paddingBottom: space.xl }}>
          <View style={{ paddingHorizontal: space.xl, gap: space.xs }}>
            <AppText variant="label" tone="#FFFFFF">
              {pkg.destination.name} · {nights}
            </AppText>
            <AppText variant="title" tone="#FFFFFF" accessibilityRole="header">
              {title}
            </AppText>
          </View>
        </PhotoBackground>
        <OfflineBanner offline={!online} />

        <View style={{ padding: space.xl, gap: space.md }}>
          {previousPrice ? (
            <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.input, backgroundColor: c.surface, borderWidth: 1, borderColor: c.warning }}>
              <Ionicons name="pricetag-outline" size={18} color={c.warning} />
              <AppText variant="label" style={{ flex: 1 }} accessibilityLiveRegion="polite">
                {t('pkg.priceChanged', { old: formatKes(previousPrice) })}
              </AppText>
            </View>
          ) : null}

          <PriceTag totalKes={pkg.fromPriceKes} instalments={preview} size="lg" />
          {preview ? <InstalmentBadge count={preview.times} amountKes={preview.amountKes} /> : null}
          <AppText variant="body" tone="textMuted">
            {localised(pkg, 'summary', lang)}
          </AppText>

          <Section title={t('pkg.plan')}>
            {pkg.items.map((item) => (
              <DayPlanItem key={`${item.day}-${item.title}`} day={t('pkg.day', { n: item.day })} title={item.title} items={[item.provider.name]} />
            ))}
          </Section>

          <Section title={t('pkg.included')}>
            {pkg.inclusions.map((x) => (
              <Bullet key={x} icon="checkmark-circle" tone="success">{x}</Bullet>
            ))}
            {pkg.exclusions.length ? (
              <>
                <AppText variant="heading" style={{ marginTop: space.md }}>{t('pkg.notIncluded')}</AppText>
                {pkg.exclusions.map((x) => (
                  <Bullet key={x} icon="close-circle-outline" tone="textMuted">{x}</Bullet>
                ))}
              </>
            ) : null}
          </Section>

          <Section title={t('pkg.paymentPlan')}>
            {preview ? (
              <>
                {preview.schedule.map((amount, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.divider }}>
                    <AppText variant="body">{i === 0 ? t('pkg.deposit') : t('pkg.instalmentN', { n: i })}</AppText>
                    <AppText variant="body" tabular style={{ fontWeight: '600' }}>{formatKes(amount)}</AppText>
                  </View>
                ))}
                <AppText variant="caption" tone="textMuted">{t('pkg.payPlanNote', { days: pkg.finalDueDays })}</AppText>
              </>
            ) : (
              <AppText variant="body">{t('pkg.payInFull')}</AppText>
            )}
          </Section>

          <Section title={t('pkg.cancelPolicy')}>
            {refundLines(pkg.cancelPolicy, t).map((line) => (
              <Bullet key={line} icon="return-down-back-outline" tone="primary">{line}</Bullet>
            ))}
          </Section>

          <Section title={t('pkg.providers')}>
            {providers.map((p) => (
              <View key={p.name} style={{ gap: space.xs, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.divider }}>
                <AppText variant="body" style={{ fontWeight: '600' }}>{p.name}</AppText>
                {p.verified_at && p.licence_no ? <VerifiedBadge licenceNo={p.licence_no} verifiedAt={p.verified_at} /> : null}
              </View>
            ))}
          </Section>

          <Section title={t('pkg.reviews')}>
            {rating ? (
              <>
                <AppText variant="heading">{t('pkg.ratingSummary', { rating, n: pkg.reviews.length })}</AppText>
                {pkg.reviews.slice(0, 5).map((r) => (
                  <View key={r.created_at} style={{ backgroundColor: c.surface, borderRadius: radius.input, padding: space.lg, gap: space.xs }}>
                    <AppText variant="label" tone="primary" accessibilityLabel={t('pkg.ratingSummary', { rating: r.rating, n: 1 })}>
                      {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                    </AppText>
                    {r.body ? <AppText variant="body">{r.body}</AppText> : null}
                    <AppText variant="caption" tone="textMuted">
                      {t('pkg.verifiedTraveller')} · {formatDate(r.created_at, lang)}
                    </AppText>
                  </View>
                ))}
              </>
            ) : (
              <AppText variant="body" tone="textMuted">{t('pkg.noReviews')}</AppText>
            )}
          </Section>

          {faq.length ? (
            <Section title={t('destination.faq')}>
              {faq.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
            </Section>
          ) : null}

          <Button label={pkg.destination.name} variant="ghost" icon="map-outline" onPress={() => router.push(`/d/${pkg.destination.slug}`)} style={{ alignSelf: 'flex-start', marginTop: space.lg }} />
        </View>
      </ScrollView>

      <StickyPriceBar totalKes={pkg.fromPriceKes} instalments={preview} ctaLabel={t('pkg.book')} onCta={onBook} />
    </View>
  );
}
