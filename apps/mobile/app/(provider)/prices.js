/** Prices: net price seasons per listing. The traveller price is always computed on the server. */
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addDays, todayInKenya } from '@safiri/shared';
import { AppText, Button, Skeleton, TextField } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { ListingPicker, NoListings, useListings } from '../../src/features/provider/ListingPicker';
import { useSaveSeasons, useSeasons } from '../../src/features/provider/api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function Prices() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const { providers, listings } = useListings();
  const [listingId, setListingId] = useState(null);
  const [rows, setRows] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!listingId && listings.length) setListingId(listings[0].id);
  }, [listings, listingId]);
  const seasons = useSeasons(listingId);
  const save = useSaveSeasons(listingId);
  useEffect(() => {
    if (seasons.data) setRows(seasons.data.map((s) => ({ seasonStart: s.seasonStart, seasonEnd: s.seasonEnd, netKes: String(s.netKes) })));
  }, [seasons.data]);

  if (providers.data && !listings.length) return <NoListings />;
  const listing = listings.find((l) => l.id === listingId);

  const valid = rows?.every((r) => DATE.test(r.seasonStart) && DATE.test(r.seasonEnd) && r.seasonEnd >= r.seasonStart && Number(r.netKes) >= 100);
  const update = (i, patch) => { setSaved(false); setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r))); };
  const add = () => {
    const last = rows[rows.length - 1];
    const start = last ? addDays(last.seasonEnd, 1) : todayInKenya();
    setRows([...rows, { seasonStart: start, seasonEnd: addDays(start, 90), netKes: last?.netKes || '' }]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <ListingPicker listings={listings} value={listingId} onChange={(id) => { setListingId(id); setRows(null); }} />
      {listing ? <AppText variant="caption" tone="textMuted">{t('provider.pricesHint', { unit: t(`provider.units.${listing.unit}`) })}</AppText> : null}

      {!rows ? <Skeleton variant="block" height={120} /> : rows.map((r, i) => (
        <View key={i} style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface, gap: space.sm }}>
          <AppText variant="heading">{rows.length === 1 ? t('provider.allYear') : t('provider.season', { n: i + 1 })}</AppText>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextField label={t('provider.from')} value={r.seasonStart} onChangeText={(v) => update(i, { seasonStart: v })} placeholder="2026-12-01" keyboardType="numbers-and-punctuation" maxLength={10} error={r.seasonStart && !DATE.test(r.seasonStart)} />
            <TextField label={t('provider.to')} value={r.seasonEnd} onChangeText={(v) => update(i, { seasonEnd: v })} placeholder="2027-01-10" keyboardType="numbers-and-punctuation" maxLength={10} error={r.seasonEnd && (!DATE.test(r.seasonEnd) || r.seasonEnd < r.seasonStart)} />
          </View>
          <TextField label={t('provider.netPrice')} value={r.netKes} onChangeText={(v) => update(i, { netKes: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={6} error={r.netKes !== '' && Number(r.netKes) < 100} />
          {rows.length > 1 ? <Button label={t('provider.removeSeason')} variant="ghost" icon="trash-outline" onPress={() => { setSaved(false); setRows(rows.filter((_, j) => j !== i)); }} /> : null}
        </View>
      ))}

      {rows ? <Button label={t('provider.addSeason')} icon="add" variant="secondary" onPress={add} disabled={rows.length >= 12} /> : null}
      {save.isError ? <AppText variant="body" tone="danger">{t('errors.generic')}</AppText> : null}
      {saved ? <AppText variant="label" tone="success" accessibilityLiveRegion="polite">{t('provider.pricesSaved')}</AppText> : null}
      {rows ? (
        <Button
          label={t('provider.savePrices')}
          icon="save-outline"
          loading={save.isPending}
          disabled={!valid || !rows.length}
          onPress={() => save.mutate(rows.map((r) => ({ seasonStart: r.seasonStart, seasonEnd: r.seasonEnd, netKes: Number(r.netKes) })), { onSuccess: () => setSaved(true) })}
        />
      ) : null}
    </ScrollView>
  );
}
