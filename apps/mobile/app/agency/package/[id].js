/**
 * Package editor: what the traveller sees (title, nights, included), the agency's terms
 * (margin, deposit, instalments, cancellation tiers) and the items from linked providers'
 * listings. Prices are never typed here: the server prices the package when it is saved.
 */
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText, Button, Chip, EmptyState, Skeleton, Stepper, TextField } from '../../../src/components';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { maxFontScale } from '../../../src/theme/tokens';
import { formatKes } from '../../../src/lib/format';
import { useStaff } from '../../../src/features/account/api';
import { useManagedDestinations, useManagedListings, useManagedPackage, useSavePackage, useSetPackageStatus } from '../../../src/features/agency/api';

const DEFAULTS = {
  title: '', summary: '', swTitle: '', swSummary: '', destinationId: null, nights: 2, marginBps: 1500, depositPct: 30, instalments: 3, finalDueDays: 7, graceDays: 3,
  cancelPolicy: [{ days_before: 14, refund_pct: 80 }, { days_before: 7, refund_pct: 50 }, { days_before: 0, refund_pct: 0 }],
  inclusions: '', exclusions: '', items: [],
};

const fromPackage = (p) => ({
  title: p.title, summary: p.summary || '', swTitle: p.sw?.title || '', swSummary: p.sw?.summary || '', destinationId: p.destinationId, nights: p.nights,
  marginBps: p.marginBps, depositPct: p.depositPct, instalments: p.instalments, finalDueDays: p.finalDueDays, graceDays: p.graceDays,
  cancelPolicy: p.cancelPolicy, inclusions: (p.inclusions || []).join('\n'), exclusions: (p.exclusions || []).join('\n'),
  items: p.items.map((i) => ({ listingId: i.listingId, day: i.day, qty: i.qty, startTime: i.startTime || '', title: i.title, provider: i.provider, unit: i.unit })),
});

const lines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20);

function MultilineField({ label, value, onChangeText, hint }) {
  const { c, radius, space, type } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="label">{label}</AppText>
      <TextInput value={value} onChangeText={onChangeText} multiline maxLength={2000} maxFontSizeMultiplier={maxFontScale} accessibilityLabel={label} placeholder={hint} placeholderTextColor={c.textMuted}
        style={[type.body, { minHeight: 88, padding: space.md, color: c.text, backgroundColor: c.surface, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.input, textAlignVertical: 'top' }]} />
    </View>
  );
}

export default function PackageEditor() {
  const { id } = useLocalSearchParams();
  const isNew = id === 'new';
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const staff = useStaff();
  const pkg = useManagedPackage(id);
  const destinations = useManagedDestinations();
  const save = useSavePackage();
  const setStatus = useSetPackageStatus();
  const [d, setD] = useState(isNew ? DEFAULTS : null);
  const [agencyId, setAgencyId] = useState(null);
  const [picking, setPicking] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (pkg.data && !d) { setD(fromPackage(pkg.data)); setAgencyId(pkg.data.agencyId); } }, [pkg.data, d]);
  useEffect(() => { if (!agencyId && staff.data?.agencies?.length) setAgencyId(staff.data.agencies[0].id); }, [staff.data, agencyId]);
  const listings = useManagedListings(d?.destinationId, agencyId);
  const set = (patch) => { setSaved(false); setD((x) => ({ ...x, ...patch })); };

  const estimate = useMemo(() => {
    if (!d || !listings.data) return null;
    // A rough per-person figure from current net prices, so the agency sees the effect of margin as they edit.
    const net = d.items.reduce((sum, it) => {
      const l = listings.data.find((x) => x.id === it.listingId);
      if (!l?.netKes) return sum;
      return sum + (l.unit === 'person' ? l.netKes * it.qty : Math.ceil((l.netKes * it.qty) / 2));
    }, 0);
    return net ? Math.round(net * (1 + d.marginBps / 10000) * 1.05) : null;
  }, [d, listings.data]);

  if (!d || (!isNew && pkg.isPending)) return <View style={{ padding: space.xl }}><Skeleton variant="block" height={300} /></View>;
  if (!isNew && pkg.isError) return <EmptyState icon="alert-circle-outline" tone="danger" title={t('errors.generic')} action={{ label: t('common.back'), onPress: () => router.back() }} />;

  const input = {
    ...(staff.data?.admin && agencyId ? { agencyId } : {}),
    destinationId: d.destinationId, title: d.title.trim(), summary: d.summary.trim() || undefined, nights: d.nights, marginBps: d.marginBps, depositPct: d.depositPct,
    instalments: d.instalments, finalDueDays: d.finalDueDays, graceDays: d.graceDays, cancelPolicy: d.cancelPolicy, inclusions: lines(d.inclusions), exclusions: lines(d.exclusions),
    heroImage: null, items: d.items.map((i) => ({ listingId: i.listingId, day: i.day, qty: i.qty, startTime: i.startTime || null })),
    ...(d.swTitle || d.swSummary ? { sw: { title: d.swTitle || undefined, summary: d.swSummary || undefined } } : {}),
  };
  const valid = d.title.trim().length >= 2 && d.destinationId && d.items.length > 0 && d.items.every((i) => i.day <= d.nights + 1) && d.cancelPolicy.some((x) => x.days_before === 0);
  const errorText = (err) => (err?.code === 'unpriceable' ? t('agency.unpriceable') : err?.code === 'listing_not_allowed' ? t('agency.listingNotAllowed') : err?.offline ? t('errors.network') : t('errors.generic'));

  const onSave = () => save.mutate({ id, input }, { onSuccess: (r) => { setSaved(true); if (isNew) router.replace(`/agency/package/${r.id}`); } });
  const status = pkg.data?.status;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {pkg.data ? (
          <AppText variant="caption" tone="textMuted">{t(`agency.${status}`)}{pkg.data.fromPriceKes ? ` · ${t('agency.livePrice', { amount: formatKes(pkg.data.fromPriceKes) })}` : ''}</AppText>
        ) : null}

        <TextField label={t('agency.title')} value={d.title} onChangeText={(v) => set({ title: v })} maxLength={80} />
        <MultilineField label={t('agency.summary')} value={d.summary} onChangeText={(v) => set({ summary: v })} />
        <TextField label={`${t('agency.title')} (Kiswahili)`} value={d.swTitle} onChangeText={(v) => set({ swTitle: v })} maxLength={80} />
        <MultilineField label={`${t('agency.summary')} (Kiswahili)`} value={d.swSummary} onChangeText={(v) => set({ swSummary: v })} />

        <AppText variant="label">{t('agency.destination')}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(destinations.data || []).map((x) => <Chip key={x.id} label={x.name} selected={d.destinationId === x.id} onPress={() => set({ destinationId: x.id, items: [] })} />)}
        </View>
        {staff.data?.admin && staff.data.agencies?.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {staff.data.agencies.map((a) => <Chip key={a.id} label={a.name} selected={agencyId === a.id} onPress={() => { setAgencyId(a.id); set({ items: [] }); }} />)}
          </View>
        ) : null}

        <Stepper label={t('agency.nights')} value={d.nights} min={0} max={14} onChange={(v) => set({ nights: v, items: d.items.filter((i) => i.day <= v + 1) })} />
        <Stepper label={t('agency.margin')} hint={`${(d.marginBps / 100).toFixed(1)}%`} value={d.marginBps / 100} min={0} max={50} onChange={(v) => set({ marginBps: v * 100 })} />
        <Stepper label={t('agency.deposit')} hint="%" value={d.depositPct} min={5} max={100} onChange={(v) => set({ depositPct: v })} />
        <Stepper label={t('agency.instalments')} value={d.instalments} min={0} max={12} onChange={(v) => set({ instalments: v })} />
        <Stepper label={t('agency.finalDue')} value={d.finalDueDays} min={0} max={60} onChange={(v) => set({ finalDueDays: v })} />
        <Stepper label={t('agency.grace')} value={d.graceDays} min={0} max={14} onChange={(v) => set({ graceDays: v })} />

        <AppText variant="heading" accessibilityRole="header">{t('agency.policy')}</AppText>
        {d.cancelPolicy.map((tier, i) => (
          <View key={i} style={{ padding: space.md, borderRadius: radius.card, backgroundColor: c.surface, gap: space.xs }}>
            <AppText variant="body">{tier.days_before === 0 ? t('agency.finalTier', { pct: tier.refund_pct }) : t('agency.tier', { days: tier.days_before, pct: tier.refund_pct })}</AppText>
            {tier.days_before !== 0 ? <Stepper label={t('agency.finalDue')} value={tier.days_before} min={1} max={90} onChange={(v) => set({ cancelPolicy: d.cancelPolicy.map((x, j) => (j === i ? { ...x, days_before: v } : x)) })} /> : null}
            <Stepper label="%" value={tier.refund_pct} min={0} max={100} onChange={(v) => set({ cancelPolicy: d.cancelPolicy.map((x, j) => (j === i ? { ...x, refund_pct: v } : x)) })} />
          </View>
        ))}

        <MultilineField label={t('agency.inclusions')} value={d.inclusions} onChangeText={(v) => set({ inclusions: v })} />
        <MultilineField label={t('agency.exclusions')} value={d.exclusions} onChangeText={(v) => set({ exclusions: v })} />

        <AppText variant="heading" accessibilityRole="header">{t('agency.items')}</AppText>
        {d.items.map((it, i) => (
          <View key={`${it.listingId}-${i}`} style={{ padding: space.md, borderRadius: radius.card, backgroundColor: c.surface, gap: space.xs }}>
            <AppText variant="body" style={{ fontWeight: '600' }}>{it.title}</AppText>
            <AppText variant="caption" tone="textMuted">{it.provider}</AppText>
            <Stepper label={t('agency.day')} value={it.day} min={1} max={d.nights + 1} onChange={(v) => set({ items: d.items.map((x, j) => (j === i ? { ...x, day: v } : x)) })} />
            <Stepper label={t('agency.qty')} value={it.qty} min={1} max={14} onChange={(v) => set({ items: d.items.map((x, j) => (j === i ? { ...x, qty: v } : x)) })} />
            <TextField label={t('agency.time')} value={it.startTime} onChangeText={(v) => set({ items: d.items.map((x, j) => (j === i ? { ...x, startTime: v } : x)) })} placeholder="08:00" maxLength={5} error={it.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(it.startTime)} />
            <Button label={t('agency.removeItem')} variant="ghost" icon="trash-outline" onPress={() => set({ items: d.items.filter((_, j) => j !== i) })} />
          </View>
        ))}
        {d.destinationId ? <Button label={t('agency.addItem')} icon="add" variant="secondary" onPress={() => setPicking((v) => !v)} /> : null}
        {picking ? (
          <View style={{ gap: space.sm }}>
            <AppText variant="label">{t('agency.pickListing')}</AppText>
            {listings.data && !listings.data.length ? <AppText variant="body" tone="textMuted">{t('agency.noListings')}</AppText> : null}
            {(listings.data || []).map((l) => (
              <Chip key={l.id} label={`${l.title} · ${l.provider}${l.netKes ? ` · ${formatKes(l.netKes)}/${t(`provider.units.${l.unit}`)}` : ''}`} icon="add"
                onPress={() => { set({ items: [...d.items, { listingId: l.id, day: 1, qty: l.kind === 'stay' ? Math.max(1, d.nights) : 1, startTime: '', title: l.title, provider: l.provider, unit: l.unit }] }); setPicking(false); }} />
            ))}
          </View>
        ) : null}

        {estimate ? <AppText variant="body" tabular>{t('agency.estimate', { amount: formatKes(estimate) })}</AppText> : null}
        <AppText variant="caption" tone="textMuted">{t('agency.estimateHint')}</AppText>

        {save.isError ? <AppText variant="body" tone="danger">{errorText(save.error)}</AppText> : null}
        {setStatus.isError ? <AppText variant="body" tone="danger">{errorText(setStatus.error)}</AppText> : null}
        {saved ? <AppText variant="label" tone="success" accessibilityLiveRegion="polite">{t('agency.saved')}</AppText> : null}

        <Button label={t('agency.save')} icon="save-outline" onPress={onSave} loading={save.isPending} disabled={!valid} />
        {!isNew && status ? (
          <Button
            label={status === 'published' ? t('agency.unpublish') : t('agency.publish')}
            icon={status === 'published' ? 'eye-off-outline' : 'cloud-upload-outline'}
            variant="secondary"
            loading={setStatus.isPending}
            onPress={() => setStatus.mutate({ id, publish: status !== 'published' })}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
