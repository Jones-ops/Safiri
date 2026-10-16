/**
 * Provider sign-up in 6 short steps, saved on the phone as they go (a lodge owner fills this
 * in between guests). One API call at the end creates the business, its first listing, a price
 * and 180 days of availability. Safiri verifies before anything is bookable.
 */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { msisdnSchema } from '@safiri/shared';
import { AppText, Button, Chip, EmptyState, PhoneInput, Stepper, TextField } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { settingsStore } from '../../src/lib/storage';
import { useDestinations } from '../../src/features/catalogue/queries';
import { useOnboard } from '../../src/features/provider/api';
import { useSettings } from '../../src/state/settings';

const DRAFT_KEY = 'provider-onboard-draft';
const TYPES = ['lodge', 'guide', 'driver', 'activity'];
const KIND_FOR = { lodge: 'stay', guide: 'activity', driver: 'transport', activity: 'activity' };
const UNIT_FOR = { lodge: 'night', guide: 'day', driver: 'day', activity: 'person' };

const empty = { step: 1, type: null, name: '', destinationId: null, locationName: '', lat: null, lng: null, title: '', capacity: 4, netKes: '', whatsapp: '', payout: '', licence: '' };
const load = () => { try { return { ...empty, ...JSON.parse(settingsStore.getString(DRAFT_KEY) || '{}') }; } catch { return empty; } };

export default function Onboard() {
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const [d, setD] = useState(load);
  const [done, setDone] = useState(false);
  const destinations = useDestinations();
  const onboard = useOnboard();
  const setMode = useSettings((s) => s.setMode);
  useEffect(() => { settingsStore.set(DRAFT_KEY, JSON.stringify(d)); }, [d]);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));

  const phoneOk = (v) => msisdnSchema.safeParse(v).success;
  const canNext = {
    1: Boolean(d.type),
    2: d.name.trim().length >= 2,
    3: Boolean(d.destinationId),
    4: d.title.trim().length >= 2 && Number(d.netKes) >= 100,
    5: phoneOk(d.whatsapp) && phoneOk(d.payout),
    6: true,
  }[d.step];

  const submit = () => {
    onboard.mutate({
      type: d.type, name: d.name.trim(), destinationId: d.destinationId, locationName: d.locationName.trim() || undefined,
      lat: d.lat ?? undefined, lng: d.lng ?? undefined,
      whatsappPhone: msisdnSchema.parse(d.whatsapp), payoutPhone: msisdnSchema.parse(d.payout), licenceNo: d.licence.trim() || undefined,
      listing: { title: d.title.trim(), kind: KIND_FOR[d.type], unit: UNIT_FOR[d.type], capacity: d.capacity, netKes: Number(d.netKes) },
    }, { onSuccess: () => { settingsStore.remove(DRAFT_KEY); setDone(true); } });
  };

  const useMyLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    set({ lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lng: Math.round(pos.coords.longitude * 1e5) / 1e5 });
  };

  if (done) {
    return <EmptyState icon="checkmark-circle-outline" title={t('onboard.done')} body={t('onboard.doneBody')} action={{ label: t('tabs.requests'), onPress: () => { setMode('provider'); router.replace('/requests'); } }} />;
  }

  const destination = (destinations.data || []).find((x) => x.id === d.destinationId);
  const field = (label, key, extra = {}) => <TextField label={label} value={d[key]} onChangeText={(v) => set({ [key]: v })} {...extra} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <AppText variant="caption" tone="textMuted">{t('onboard.stepOf', { n: d.step })}</AppText>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 6, now: d.step }} style={{ height: 6, borderRadius: 3, backgroundColor: c.primarySoft }}>
          <View style={{ width: `${(d.step / 6) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: c.primary }} />
        </View>

        {d.step === 1 ? (
          <View style={{ gap: space.md }}>
            <AppText variant="title" accessibilityRole="header">{t('onboard.type')}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {TYPES.map((x) => <Chip key={x} label={t(`provider.types.${x}`)} selected={d.type === x} onPress={() => set({ type: x })} />)}
            </View>
          </View>
        ) : null}

        {d.step === 2 ? (
          <View style={{ gap: space.md }}>
            <AppText variant="title" accessibilityRole="header">{t('onboard.name')}</AppText>
            {field(t('onboard.name'), 'name', { maxLength: 80 })}
            {field(t('onboard.licence'), 'licence', { maxLength: 40 })}
          </View>
        ) : null}

        {d.step === 3 ? (
          <View style={{ gap: space.md }}>
            <AppText variant="title" accessibilityRole="header">{t('onboard.where')}</AppText>
            <AppText variant="label">{t('onboard.destination')}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {(destinations.data || []).map((x) => <Chip key={x.id} label={x.name} selected={d.destinationId === x.id} onPress={() => set({ destinationId: x.id })} />)}
            </View>
            {field(t('onboard.locationName'), 'locationName', { maxLength: 120 })}
            <Button label={t('onboard.useMyLocation')} icon="locate-outline" variant="secondary" onPress={useMyLocation} />
            {d.lat != null ? <AppText variant="caption" tone="textMuted" tabular>{d.lat}, {d.lng}</AppText> : null}
          </View>
        ) : null}

        {d.step === 4 ? (
          <View style={{ gap: space.md }}>
            <AppText variant="title" accessibilityRole="header">{t('onboard.listingTitle')}</AppText>
            {field(t('onboard.listingTitle'), 'title', { placeholder: t('onboard.listingTitleHint'), maxLength: 80 })}
            <AppText variant="body" tone="textMuted">{t('onboard.unit')}: {t(`provider.units.${UNIT_FOR[d.type]}`)}</AppText>
            <Stepper label={t('onboard.capacity')} value={d.capacity} min={1} max={200} onChange={(v) => set({ capacity: v })} />
            {field(t('onboard.netKes'), 'netKes', { keyboardType: 'number-pad', maxLength: 6, error: d.netKes !== '' && Number(d.netKes) < 100 })}
            <AppText variant="caption" tone="textMuted">{t('onboard.netHint')}</AppText>
          </View>
        ) : null}

        {d.step === 5 ? (
          <View style={{ gap: space.md }}>
            <AppText variant="title" accessibilityRole="header">{t('onboard.contacts')}</AppText>
            <PhoneInput label={t('onboard.whatsapp')} value={d.whatsapp} onChange={(v) => set({ whatsapp: v })} error={d.whatsapp && !phoneOk(d.whatsapp) ? 'errors.phone.invalid' : null} />
            <PhoneInput label={t('onboard.payout')} value={d.payout} onChange={(v) => set({ payout: v })} error={d.payout && !phoneOk(d.payout) ? 'errors.phone.invalid' : null} />
          </View>
        ) : null}

        {d.step === 6 ? (
          <View style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface, gap: space.xs }}>
            <AppText variant="heading">{d.name}</AppText>
            <AppText variant="body" tone="textMuted">{t(`provider.types.${d.type}`)} · {destination?.name}{d.locationName ? ` · ${d.locationName}` : ''}</AppText>
            <AppText variant="body">{d.title} · KES {Number(d.netKes).toLocaleString(i18n.language === 'sw' ? 'sw-KE' : 'en-KE')} / {t(`provider.units.${UNIT_FOR[d.type]}`)} · {d.capacity}</AppText>
            <AppText variant="caption" tone="textMuted">WhatsApp {d.whatsapp} · M-PESA {d.payout}</AppText>
          </View>
        ) : null}

        {onboard.isError ? <AppText variant="body" tone="danger">{onboard.error.offline ? t('errors.network') : t('errors.generic')}</AppText> : null}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {d.step > 1 ? <Button label={t('common.back')} variant="secondary" onPress={() => set({ step: d.step - 1 })} style={{ flex: 1 }} /> : null}
          {d.step < 6
            ? <Button label={t('onboard.next')} icon="arrow-forward" onPress={() => set({ step: d.step + 1 })} disabled={!canNext} style={{ flex: 2 }} />
            : <Button label={t('onboard.finish')} icon="checkmark" onPress={submit} loading={onboard.isPending} style={{ flex: 2 }} />}
        </View>
        <AppText variant="caption" tone="textMuted">{t('onboard.saved')}</AppText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
