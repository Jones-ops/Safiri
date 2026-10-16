import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { todayInKenya } from '@safiri/shared';
import { useTheme } from '../theme/ThemeProvider';
import { formatDate, formatKes } from '../lib/format';
import { AppText } from './AppText';
import { Button } from './Button';
import { StatusLabel } from './StatusLabel';

/** A trip in the Trips tab: dates, status, how much is paid, and the next payment with Pay. */
export function TripCard({ trip, onPress, onPay, paying, onCancel, onReview }) {
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const progress = trip.totalKes ? Math.min(1, trip.paidKes / trip.totalKes) : 0;
  const next = trip.status === 'confirmed' ? trip.nextPayment : null;
  const overdue = next && next.dueDate < todayInKenya();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.sm }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <AppText variant="heading" style={{ flex: 1 }} numberOfLines={2}>{trip.title || trip.ref}</AppText>
        <AppText variant="caption" tone="textMuted">{trip.ref}</AppText>
      </View>
      <AppText variant="label" tone="textMuted">
        {t('hold.dates', { from: formatDate(trip.startDate, lang), to: formatDate(trip.endDate, lang) })} · {t(`trips.status.${trip.status}`)}
      </AppText>

      {trip.status !== 'cancelled' ? (
        <View style={{ gap: space.xs }}>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: trip.totalKes, now: trip.paidKes }}
            style={{ height: 8, borderRadius: 4, backgroundColor: c.primarySoft, overflow: 'hidden' }}
          >
            <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: c.primary }} />
          </View>
          <AppText variant="caption" tone="textMuted" tabular>
            {t('trips.progress', { paid: formatKes(trip.paidKes), total: formatKes(trip.totalKes) })}
          </AppText>
        </View>
      ) : null}

      {next ? (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
            <AppText variant="body" style={{ flex: 1 }}>
              {overdue
                ? t('pay.overdueSince', { date: formatDate(next.dueDate, lang) })
                : t('trips.nextDue', { amount: formatKes(next.amountKes), date: formatDate(next.dueDate, lang) })}
            </AppText>
            <StatusLabel status={overdue ? 'overdue' : 'due'} />
          </View>
          {onPay ? <Button label={t('trips.payNext', { amount: formatKes(next.amountKes) })} icon="phone-portrait-outline" onPress={onPay} loading={paying} /> : null}
        </View>
      ) : null}

      {onReview ? (
        <Button label={trip.reviewed ? t('trip.reviewDone') : t('trip.review')} icon={trip.reviewed ? 'checkmark-circle-outline' : 'star-outline'} variant="secondary" onPress={onReview} disabled={trip.reviewed} />
      ) : null}
      {onCancel ? <Button label={t('trip.cancel')} icon="close-circle-outline" variant="ghost" onPress={onCancel} /> : null}
    </Pressable>
  );
}
