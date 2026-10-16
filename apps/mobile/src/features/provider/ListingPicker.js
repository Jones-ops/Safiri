/** Which listing the Calendar and Prices tabs work on: chips when there is more than one. */
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip, EmptyState } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { useMyProviders } from '../account/api';
import { router } from 'expo-router';

export function useListings() {
  const providers = useMyProviders();
  const listings = (providers.data || []).flatMap((p) => p.listings.map((l) => ({ ...l, provider: p.name })));
  return { providers, listings };
}

export function ListingPicker({ listings, value, onChange }) {
  const { space } = useTheme();
  if (listings.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      {listings.map((l) => <Chip key={l.id} label={l.title} selected={l.id === value} onPress={() => onChange(l.id)} />)}
    </ScrollView>
  );
}

export function NoListings() {
  const { t } = useTranslation();
  return <EmptyState icon="storefront-outline" title={t('modes.becomeProvider')} body={t('modes.becomeProviderHint')} action={{ label: t('onboard.title'), onPress: () => router.push('/provider/onboard') }} />;
}
