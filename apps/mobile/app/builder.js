/**
 * Trip builder. Two ways in:
 *   /builder?package=<slug>       a package: choose dates and travellers
 *   /builder?destination=<slug>   a custom trip: also choose nights, a stay, things to do, transport
 * Every change asks the API for a quote; the price bar only ever shows the server's number.
 * "Hold my place" takes the rooms for 15 minutes (POST /v1/holds).
 */
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { FUNNEL, addDays, msisdnSchema, todayInKenya } from '@safiri/shared';
import { AppText, Chip, EmptyState, PhoneInput, Skeleton, StickyPriceBar, Stepper, TextField } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatDate, formatDayChip, formatKes } from '../src/lib/format';
import { useSession } from '../src/features/auth/session';
import { track } from '../src/analytics';
import { localised, useDestination, useListings, usePackage } from '../src/features/catalogue/queries';
import { usePlaceHold, useQuote } from '../src/features/build/api';

const DATE_CHOICES = 60;
const HOLD_ERRORS = { sold_out: 'hold.soldOut', too_many_holds: 'hold.tooManyHolds', quote_expired: 'hold.quoteExpired' };

/** The next Saturday at least 2 days away: a sensible first date for a weekend getaway. */
function defaultStart() {
  let d = addDays(todayInKenya(), 2);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1);
  return d;
}

function Section({ title, children }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm, marginTop: space.xl }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function Notice({ icon, tone, children }) {
  const { c, radius, space } = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.input, borderWidth: 1, borderColor: c[tone], backgroundColor: c.surface }}
    >
      <Ionicons name={icon} size={18} color={c[tone]} />
      <AppText variant="label" style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

/** One listing in a custom-trip section: add/remove, and (for activities) which day. */
function ItemRow({ listing, added, day, maxDay, unavailable, onToggle, onDay, showDays }) {
  const { c, space } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.divider, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <AppText variant="body">{listing.title}</AppText>
          {added && unavailable ? (
            <AppText variant="caption" tone="danger">
              {t('builder.unavailable')}
            </AppText>
          ) : null}
        </View>
        <Chip label={added ? t('builder.added') : t('builder.add')} selected={added} onPress={onToggle} icon="add" />
      </View>
      {added && showDays && maxDay > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((n) => (
            <Chip key={n} label={t('builder.onDay', { n })} selected={day === n} onPress={() => onDay(n)} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

export default function Builder() {
  const { package: packageSlug, destination: destinationSlug } = useLocalSearchParams();
  const { c, space } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useSession();

  const pkgQuery = usePackage(packageSlug);
  const destQuery = useDestination(destinationSlug);
  const listingsQuery = useListings(destinationSlug);
  const custom = Boolean(destinationSlug);

  const [startDate, setStartDate] = useState(defaultStart);
  const [travellers, setTravellers] = useState(2);
  const [nights, setNights] = useState(2);
  const [stayId, setStayId] = useState(null);
  const [activityDays, setActivityDays] = useState({}); // listingId -> day
  const [transportIds, setTransportIds] = useState([]);
  const [phone, setPhone] = useState('');
  const [referral, setReferral] = useState('');
  const [holdError, setHoldError] = useState(null);
  // A friend's code counts only once it looks complete, so typing does not re-price on each key.
  const referralCode = session && /^[A-Za-z0-9]{6,10}$/.test(referral.trim()) ? referral.trim().toUpperCase() : undefined;

  useEffect(() => {
    track(FUNNEL.OPEN_BUILDER, { packageSlug: packageSlug || null, destinationSlug: destinationSlug || null });
  }, [packageSlug, destinationSlug]);

  // Keep activities inside the trip when nights change.
  useEffect(() => {
    setActivityDays((days) => Object.fromEntries(Object.entries(days).map(([id, d]) => [id, Math.min(d, nights + 1)])));
  }, [nights]);

  const listings = useMemo(() => listingsQuery.data || [], [listingsQuery.data]);
  const byKind = (kind) => listings.filter((l) => l.kind === kind);

  const request = useMemo(() => {
    if (!custom) return packageSlug ? { packageSlug, startDate, travellers, referralCode } : null;
    const items = [];
    if (stayId && nights > 0) items.push({ listingId: stayId, day: 1, qty: nights });
    for (const [listingId, day] of Object.entries(activityDays)) items.push({ listingId, day, qty: 1 });
    for (const listingId of transportIds) items.push({ listingId, day: 1, qty: 1 });
    return items.length ? { destinationSlug, nights, items, startDate, travellers, referralCode } : null;
  }, [custom, packageSlug, destinationSlug, startDate, travellers, nights, stayId, activityDays, transportIds, referralCode]);

  const quote = useQuote(request);
  const q = quote.data;
  const placeHold = usePlaceHold();

  const dates = useMemo(() => {
    const first = addDays(todayInKenya(), 1);
    return Array.from({ length: DATE_CHOICES }, (_, i) => addDays(first, i));
  }, []);

  const holdPhone = session?.user.phone || phone;
  const phoneOk = msisdnSchema.safeParse(holdPhone || '').success;
  const unavailableIds = new Set((q?.unavailable || []).map((u) => u.listingId));
  const canHold = Boolean(q) && q.available && !quote.isFetching && phoneOk && !placeHold.isPending;

  const onHold = () => {
    setHoldError(null);
    placeHold.mutate(
      { quoteId: q.id, phone: msisdnSchema.parse(holdPhone) },
      {
        onSuccess: (hold) => {
          track(FUNNEL.START_CHECKOUT, { totalKes: hold.totalKes, packageSlug: packageSlug || null });
          router.replace(`/hold/${hold.bookingId}`);
        },
        onError: (err) => {
          setHoldError(HOLD_ERRORS[err.code] || (err.offline ? 'errors.network' : 'errors.generic'));
          if (err.code === 'quote_expired' || err.code === 'sold_out') quote.refetch();
        },
      },
    );
  };

  const title = custom ? destQuery.data?.name : pkgQuery.data && localised(pkgQuery.data, 'title', lang);
  const driveHours = custom ? destQuery.data?.driveHours : pkgQuery.data?.destination?.drive_hours;
  const loading = custom ? destQuery.isPending || listingsQuery.isPending : pkgQuery.isPending;
  const missing = custom ? !destQuery.data && !destQuery.isPending : !pkgQuery.data && !pkgQuery.isPending;

  if (missing) {
    return <EmptyState icon="map-outline" title={t(custom ? 'destination.notFound' : 'pkg.notFound')} action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: t('builder.title') }} />
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
        {loading ? <Skeleton width="70%" height={24} /> : (
          <AppText variant="title" accessibilityRole="header">
            {title}
          </AppText>
        )}

        <Section title={t('builder.when')}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {dates.map((d) => {
              const chip = formatDayChip(d, lang);
              return <Chip key={d} label={`${chip.day} ${chip.date}`} selected={d === startDate} onPress={() => setStartDate(d)} icon={chip.weekend ? 'sunny-outline' : undefined} />;
            })}
          </ScrollView>
          {q ? (
            <AppText variant="caption" tone="textMuted">
              {t('hold.dates', { from: formatDate(q.startDate, lang), to: formatDate(q.endDate, lang) })}
            </AppText>
          ) : null}
        </Section>

        <View style={{ marginTop: space.lg, gap: space.sm }}>
          <Stepper label={t('builder.travellers')} hint={t('builder.travellersHint')} value={travellers} min={1} max={10} onChange={setTravellers} />
          {custom ? <Stepper label={t('builder.nights')} value={nights} min={0} max={7} onChange={setNights} /> : null}
        </View>

        {custom ? (
          <>
            <Section title={t('builder.stays')}>
              {nights === 0 ? <AppText variant="body" tone="textMuted">{t('builder.stayNeedsNights')}</AppText> : byKind('stay').map((l) => (
                <ItemRow key={l.id} listing={l} added={stayId === l.id} unavailable={unavailableIds.has(l.id)}
                  onToggle={() => setStayId(stayId === l.id ? null : l.id)} />
              ))}
            </Section>
            <Section title={t('builder.activities')}>
              {byKind('activity').map((l) => (
                <ItemRow key={l.id} listing={l} added={l.id in activityDays} day={activityDays[l.id]} maxDay={nights + 1} showDays
                  unavailable={unavailableIds.has(l.id)}
                  onToggle={() => setActivityDays((a) => {
                    const next = { ...a };
                    if (l.id in next) delete next[l.id];
                    else next[l.id] = Math.min(2, nights + 1);
                    return next;
                  })}
                  onDay={(day) => setActivityDays((a) => ({ ...a, [l.id]: day }))} />
              ))}
            </Section>
            <Section title={t('builder.transport')}>
              {byKind('transport').map((l) => (
                <ItemRow key={l.id} listing={l} added={transportIds.includes(l.id)} unavailable={unavailableIds.has(l.id)}
                  onToggle={() => setTransportIds((ids) => (ids.includes(l.id) ? ids.filter((x) => x !== l.id) : [...ids, l.id]))} />
              ))}
            </Section>
          </>
        ) : q ? (
          <Section title={t('builder.included')}>
            {[...new Map(q.lines.map((l) => [l.listingId, l])).values()].map((l) => (
              <View key={l.listingId} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                <Ionicons name={unavailableIds.has(l.listingId) ? 'close-circle' : 'checkmark-circle'} size={18}
                  color={unavailableIds.has(l.listingId) ? c.danger : c.success} style={{ marginTop: 3 }} />
                <View style={{ flex: 1 }}>
                  <AppText variant="body">{l.title}</AppText>
                  {unavailableIds.has(l.listingId) ? <AppText variant="caption" tone="danger">{t('builder.unavailable')}</AppText> : null}
                </View>
              </View>
            ))}
          </Section>
        ) : null}

        <View style={{ marginTop: space.xl, gap: space.md }}>
          {q?.driveTimeWarning ? <Notice icon="car-outline" tone="warning">{t('builder.driveWarning', { hours: driveHours })}</Notice> : null}
          {q && !q.available ? <Notice icon="alert-circle-outline" tone="danger">{t('builder.someUnavailable')}</Notice> : null}
          {quote.isError && quote.error.code ? <Notice icon="alert-circle-outline" tone="danger">{t('errors.generic')}</Notice> : null}
          {quote.isError && quote.error.offline ? <Notice icon="cloud-offline-outline" tone="danger">{t('errors.network')}</Notice> : null}
          {holdError ? <Notice icon="alert-circle-outline" tone="danger">{t(holdError)}</Notice> : null}
          {!request ? <AppText variant="body" tone="textMuted">{t('builder.pickSomething')}</AppText> : null}
          {q ? (
            <AppText variant="body" tabular style={{ fontWeight: '600' }}>
              {q.travellers === 1 ? t('builder.totalForOne', { amount: formatKes(q.totalKes) }) : t('builder.totalFor', { n: q.travellers, amount: formatKes(q.totalKes) })}
            </AppText>
          ) : null}
          {!session ? (
            <PhoneInput value={phone} onChange={setPhone} label={t('builder.phoneNeeded')} error={phone && !phoneOk ? 'errors.phone.invalid' : null} />
          ) : (
            <View style={{ gap: space.sm }}>
              <TextField label={t('builder.referral')} value={referral} onChangeText={setReferral} placeholder="ABCD2345" maxLength={10} />
              {q && referralCode && q.referralApplied ? <Notice icon="gift-outline" tone="success">{t('builder.referralApplied', { amount: formatKes(q.discountKes) })}</Notice> : null}
              {q && referralCode && !q.referralApplied && !quote.isFetching ? <Notice icon="information-circle-outline" tone="warning">{t('builder.referralNotApplied')}</Notice> : null}
            </View>
          )}
        </View>
      </ScrollView>

      {q ? (
        <StickyPriceBar
          totalKes={q.perPersonKes}
          instalments={q.perPersonInstalments}
          ctaLabel={t('builder.continue')}
          onCta={onHold}
          loading={placeHold.isPending || (quote.isFetching && !quote.isPlaceholderData)}
          disabled={!canHold}
        />
      ) : request && quote.isFetching ? (
        <View style={{ padding: space.lg, backgroundColor: c.surface }}>
          <AppText variant="label" tone="textMuted">{t('builder.pricing')}</AppText>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
