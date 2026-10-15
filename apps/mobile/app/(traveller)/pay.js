/** Pay: every payment that is due, soonest first, each with one-tap M-PESA. */
import { RefreshControl, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { todayInKenya } from '@safiri/shared';
import { AppText, Button, EmptyState, MpesaPromptSheet, OfflineBanner, PaymentStatusRow, Skeleton } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useIsOnline } from '../../src/lib/network';
import { formatKes } from '../../src/lib/format';
import { useMyTrips } from '../../src/features/trips/api';
import { useTripPayment } from '../../src/features/trips/useTripPayment';

export default function Pay() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const online = useIsOnline();
  const trips = useMyTrips();
  const payment = useTripPayment();
  const today = todayInKenya();

  if (trips.isPending) {
    return <View style={{ padding: space.xl }}><Skeleton variant="block" height={120} /></View>;
  }
  const due = (trips.data || [])
    .filter((trip) => trip.status === 'confirmed' && trip.nextPayment)
    .sort((a, b) => a.nextPayment.dueDate.localeCompare(b.nextPayment.dueDate));

  if (!due.length) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <EmptyState icon="wallet-outline" title={t('pay.emptyTitle')} body={t('pay.emptyBody')} />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner offline={!online} />
      <ScrollView
        contentContainerStyle={{ padding: space.xl, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={trips.isRefetching} onRefresh={() => trips.refetch()} />}
      >
        {due.map((trip) => (
          <View key={trip.bookingId} style={{ backgroundColor: c.surface, borderRadius: radius.card, padding: space.lg, gap: space.sm }}>
            <AppText variant="heading">{trip.title || trip.ref}</AppText>
            <PaymentStatusRow
              label={trip.ref}
              amountKes={trip.nextPayment.amountKes}
              dueDate={trip.nextPayment.dueDate}
              status={trip.nextPayment.dueDate < today ? 'overdue' : 'due'}
            />
            <Button
              label={t('trips.payNext', { amount: formatKes(trip.nextPayment.amountKes) })}
              icon="phone-portrait-outline"
              disabled={!online}
              loading={payment.flow.busy && payment.payingId === trip.bookingId}
              onPress={() => payment.payFor(trip)}
            />
          </View>
        ))}
      </ScrollView>
      <MpesaPromptSheet {...payment.flow.sheet} phone={payment.phone} />
    </View>
  );
}
