import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../src/components';

/** Trips: upcoming and past bookings with plan progress (Slice 3). */
export default function Trips() {
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <EmptyState
        icon="map-outline"
        title={t('trips.emptyTitle')}
        body={t('trips.emptyBody')}
        action={{ label: t('trips.emptyAction'), onPress: () => router.navigate('/explore') }}
      />
    </ScrollView>
  );
}
