/** Calendar: a month of days per listing. Tap days, then block or open them. Held and booked days stay. */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { todayInKenya } from '@safiri/shared';
import { AppText, Button, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { touchTarget } from '../../src/theme/tokens';
import { ListingPicker, NoListings, useListings } from '../../src/features/provider/ListingPicker';
import { useBlockDates, useCalendar } from '../../src/features/provider/api';

const monthOf = (iso) => iso.slice(0, 7);
const shiftMonth = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month, lang) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(lang === 'sw' ? 'sw-KE' : 'en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function dayState(d) {
  if (d.booked > 0) return 'booked';
  if (d.held > 0) return 'held';
  if (d.blocked) return 'blocked';
  return 'open';
}

export default function Calendar() {
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const { providers, listings } = useListings();
  const [listingId, setListingId] = useState(null);
  const [month, setMonth] = useState(monthOf(todayInKenya()));
  const [selected, setSelected] = useState([]);
  useEffect(() => {
    if (!listingId && listings.length) setListingId(listings[0].id);
  }, [listings, listingId]);
  const days = useCalendar(listingId, month);
  const block = useBlockDates(listingId);

  const grid = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00Z`);
    const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
    const byDate = new Map((days.data || []).map((d) => [d.date, d]));
    const total = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const cells = Array.from({ length: lead }, () => null);
    for (let n = 1; n <= total; n++) {
      const date = `${month}-${String(n).padStart(2, '0')}`;
      cells.push({ date, n, data: byDate.get(date) });
    }
    return cells;
  }, [month, days.data]);

  if (providers.data && !listings.length) return <NoListings />;

  const toggle = (cell) => {
    if (!cell.data || ['booked', 'held'].includes(dayState(cell.data))) return;
    setSelected((s) => (s.includes(cell.date) ? s.filter((d) => d !== cell.date) : [...s, cell.date]));
  };
  const selectedBlocked = selected.filter((d) => grid.find((x) => x?.date === d)?.data?.blocked);
  const act = (blocked) => block.mutate({ dates: selected, blocked }, { onSuccess: () => setSelected([]) });

  const colours = {
    open: { bg: c.surface, fg: c.text, icon: null },
    blocked: { bg: c.divider, fg: c.textMuted, icon: 'remove-circle-outline' },
    held: { bg: c.primarySoft, fg: c.primary, icon: 'hourglass-outline' },
    booked: { bg: c.primary, fg: c.onPrimary, icon: 'checkmark' },
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
      <ListingPicker listings={listings} value={listingId} onChange={(id) => { setListingId(id); setSelected([]); }} />
      <AppText variant="caption" tone="textMuted">{t('provider.calendarHint')}</AppText>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => { setMonth(shiftMonth(month, -1)); setSelected([]); }} accessibilityRole="button" accessibilityLabel={t('common.back')} style={{ width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={24} color={c.primary} />
        </Pressable>
        <AppText variant="heading" accessibilityRole="header">{monthLabel(month, i18n.language)}</AppText>
        <Pressable onPress={() => { setMonth(shiftMonth(month, 1)); setSelected([]); }} accessibilityRole="button" accessibilityLabel={t('common.continue')} style={{ width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-forward" size={24} color={c.primary} />
        </Pressable>
      </View>

      {days.isPending ? <Skeleton variant="block" height={280} /> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {grid.map((cell, i) => {
            if (!cell) return <View key={`pad-${i}`} style={{ width: `${100 / 7}%`, height: touchTarget }} />;
            const state = cell.data ? dayState(cell.data) : 'blocked';
            const k = colours[state];
            const isSel = selected.includes(cell.date);
            return (
              <Pressable
                key={cell.date}
                onPress={() => toggle(cell)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel, disabled: !cell.data || ['booked', 'held'].includes(state) }}
                accessibilityLabel={`${cell.n}: ${t(`provider.${state}`)}`}
                style={{ width: `${100 / 7}%`, height: touchTarget + 4, padding: 2 }}
              >
                <View style={{ flex: 1, borderRadius: radius.input, backgroundColor: k.bg, borderWidth: isSel ? 2 : 0, borderColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <AppText variant="label" tabular style={{ color: k.fg }}>{cell.n}</AppText>
                  {k.icon ? <Ionicons name={k.icon} size={12} color={k.fg} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {['open', 'blocked', 'held', 'booked'].map((s) => (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colours[s].bg, borderWidth: 1, borderColor: c.inputBorder }} />
            <AppText variant="caption" tone="textMuted">{t(`provider.${s}`)}</AppText>
          </View>
        ))}
      </View>

      {block.isError ? <AppText variant="body" tone="danger">{block.error.code === 'date_in_use' ? t('provider.dateInUse') : t('errors.generic')}</AppText> : null}
      {selected.length ? (
        <View style={{ gap: space.sm }}>
          {selected.length > selectedBlocked.length ? <Button label={t('provider.block', { n: selected.length - selectedBlocked.length })} icon="remove-circle-outline" onPress={() => act(true)} loading={block.isPending} /> : null}
          {selectedBlocked.length ? <Button label={t('provider.unblock', { n: selectedBlocked.length })} icon="checkmark-circle-outline" variant="secondary" onPress={() => act(false)} loading={block.isPending} /> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
