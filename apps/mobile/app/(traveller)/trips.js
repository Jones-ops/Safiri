/** Trips: upcoming and past bookings with plan progress and "Pay next instalment". */
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText, EmptyState, MpesaPromptSheet, OfflineBanner, Skeleton, TripCard } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useIsOnline } from '../../src/lib/network';
import { todayInKenya } from '@safiri/shared';
import { useMyTrips } from '../../src/features/trips/api';
import { useTripPayment } from '../../src/features/trips/useTripPayment';
import { SaveTripOffline } from '../../src/features/trips/SaveTripOffline';

export default function Trips() {
  const { space } = useTheme();
  const { t } = useTranslation();
  const online = useIsOnline();
  const trips = useMyTrips();
  const payment = useTripPayment();
  const today = todayInKenya();

  if (trips.isPending) {
    return (
      <View style={{ padding: space.xl, gap: space.lg }}>
        <Skeleton variant="block" height={140} />
        <Skeleton variant="block" height={140} />
      </View>
    );
  }
  const all = trips.data || [];
  if (!all.length) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        {trips.isError ? (
          <EmptyState icon="cloud-offline-outline" tone="danger" title={t('trips.loadFailed')} action={{ label: t('common.retry'), onPress: () => trips.refetch() }} />
        ) : (
          <EmptyState icon="map-outline" title={t('trips.emptyTitle')} body={t('trips.emptyBody')} action={{ label: t('trips.emptyAction'), onPress: () => router.navigate('/explore') }} />
        )}
      </ScrollView>
    );
  }

  const upcoming = all.filter((trip) => trip.status !== 'cancelled' && trip.endDate >= today);
  const past = all.filter((trip) => !upcoming.includes(trip)).reverse();
  const section = (title, list) =>
    list.length ? (
      <View style={{ gap: space.md }}>
        <AppText variant="heading" accessibilityRole="header">{title}</AppText>
        {list.map((trip) => (
          <TripCard
            key={trip.bookingId}
            trip={trip}
            onPress={() => router.push(trip.status === 'cancelled' ? `/receipt/${trip.bookingId}` : `/trip/${trip.bookingId}`)}
            onPay={online ? () => payment.payFor(trip) : undefined}
            paying={payment.flow.busy && payment.payingId === trip.bookingId}
            onCancel={['confirmed', 'fully_paid'].includes(trip.status) && trip.startDate > today ? () => router.push(`/cancel/${trip.bookingId}`) : undefined}
            onReview={trip.status === 'completed' ? () => router.push(`/review/${trip.bookingId}`) : undefined}
          />
        ))}
      </View>
    ) : null;

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner offline={!online} />
      <ScrollView
        contentContainerStyle={{ padding: space.xl, gap: space.xl }}
        refreshControl={<RefreshControl refreshing={trips.isRefetching} onRefresh={() => trips.refetch()} />}
      >
        {section(t('trips.upcoming'), upcoming)}
        {section(t('trips.past'), past)}
      </ScrollView>
      {/* Every upcoming trip is kept ready for a day without signal. */}
      {upcoming.map((trip) => <SaveTripOffline key={trip.bookingId} bookingId={trip.bookingId} />)}
      <MpesaPromptSheet {...payment.flow.sheet} phone={payment.phone} />
    </View>
  );
}
