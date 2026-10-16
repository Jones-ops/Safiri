/**
 * Itinerary (works offline): day tabs with times, the trip map, the people to call or
 * WhatsApp, and emergency numbers. Saved on the phone when the trip is confirmed; opening it
 * online refreshes the saved copy.
 */
import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { todayInKenya } from '@safiri/shared';
import { AppText, Button, Chip, DayPlanItem, EmptyState, OfflineBanner, Skeleton, TripMap } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useIsOnline } from '../../src/lib/network';
import { formatDate, formatDayChip, formatMsisdn } from '../../src/lib/format';
import { useItinerary, useTripReminders } from '../../src/features/trips/offline';

const ROLE_ICON = { lodge: 'bed-outline', guide: 'compass-outline', driver: 'car-outline', activity: 'boat-outline' };

function ContactCard({ name, role, phone }) {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface, gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <Ionicons name={ROLE_ICON[role] || 'person-outline'} size={20} color={c.primary} />
        <View style={{ flex: 1 }}>
          <AppText variant="body" style={{ fontWeight: '600' }}>{name}</AppText>
          <AppText variant="caption" tone="textMuted">{t(`trip.roles.${role}`)} · {formatMsisdn(phone)}</AppText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label={t('trip.call')} icon="call-outline" onPress={() => Linking.openURL(`tel:+${phone}`)} style={{ flex: 1 }} />
        <Button label={t('trip.whatsapp')} icon="logo-whatsapp" variant="secondary" onPress={() => Linking.openURL(`https://wa.me/${phone}`)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

export default function Trip() {
  const { id } = useLocalSearchParams();
  const { c, space } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const online = useIsOnline();
  const query = useItinerary(id);
  const entry = query.data;
  const it = entry?.itinerary;
  useTripReminders(it);

  // Open on today's tab during the trip, otherwise the first day.
  const [day, setDay] = useState(null);
  useEffect(() => {
    if (!it || day) return;
    const today = todayInKenya();
    setDay(it.days.find((d) => d.date === today)?.date || it.days[0]?.date);
  }, [it, day]);

  if (!entry && query.isPending) {
    return <View style={{ padding: space.xl, gap: space.lg }}><Stack.Screen options={{ title: t('trip.itinerary') }} /><Skeleton variant="block" height={200} /></View>;
  }
  if (!it) {
    const notConfirmed = query.error?.code === 'not_confirmed';
    return (
      <>
        <Stack.Screen options={{ title: t('trip.itinerary') }} />
        <EmptyState icon={notConfirmed ? 'time-outline' : 'cloud-offline-outline'} title={notConfirmed ? t('trip.notConfirmed') : t('errors.network')}
          action={{ label: t('common.retry'), onPress: () => query.refetch() }} />
      </>
    );
  }

  const current = it.days.find((d) => d.date === day) || it.days[0];

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t('trip.itinerary') }} />
      <OfflineBanner savedAt={entry.savedAt} offline={!online} />
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }}>
        <View style={{ gap: space.xs }}>
          <AppText variant="caption" tone="textMuted">{t('hold.ref', { ref: it.ref })}</AppText>
          <AppText variant="title" accessibilityRole="header">{it.title}</AppText>
          <AppText variant="body" tone="textMuted">
            {t('hold.dates', { from: formatDate(it.startDate, lang), to: formatDate(it.endDate, lang) })}
          </AppText>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {it.days.map((d, i) => {
            const chip = formatDayChip(d.date, lang);
            return <Chip key={d.date} label={`${t('pkg.day', { n: i + 1 })} · ${chip.day} ${chip.date}`} selected={d.date === current.date} onPress={() => setDay(d.date)} />;
          })}
        </ScrollView>
        <View>
          {current.items.length ? (
            current.items.map((item) => (
              <DayPlanItem key={`${item.time}-${item.title}`} time={item.time} title={item.title} items={[item.provider]} />
            ))
          ) : (
            <AppText variant="body" tone="textMuted">{t('trip.nothingBooked')}</AppText>
          )}
        </View>

        <AppText variant="heading" accessibilityRole="header">{t('trip.map')}</AppText>
        <TripMap itinerary={it} online={online} />

        <AppText variant="heading" accessibilityRole="header">{t('trip.contacts')}</AppText>
        {it.contacts.filter((x) => x.phone).map((x) => <ContactCard key={x.name} {...x} />)}

        <AppText variant="heading" accessibilityRole="header">{t('trip.emergency')}</AppText>
        {it.emergency.map((e) => (
          <Button key={e.phone} variant="secondary" icon="call" label={`${t(`trip.emergencyNames.${e.key}`)}: ${e.phone.length > 4 ? formatMsisdn(e.phone) : e.phone}`}
            onPress={() => Linking.openURL(`tel:${e.phone.length > 4 ? `+${e.phone}` : e.phone}`)} style={{ borderColor: c.danger }} />
        ))}

        <Button label={t('trip.payments')} variant="ghost" icon="receipt-outline" onPress={() => router.push(`/receipt/${id}`)} />
        {it.isGroup ? <Button label={t('trip.groupPayments')} variant="ghost" icon="people-outline" onPress={() => router.push(`/group/${id}`)} /> : null}
      </ScrollView>
    </View>
  );
}
