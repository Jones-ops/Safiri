import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../src/components';

/** Pay: deposits and instalments with one-tap M-PESA (Slices 3a and 3b). */
export default function Pay() {
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <EmptyState icon="wallet-outline" title={t('pay.emptyTitle')} body={t('pay.emptyBody')} />
    </ScrollView>
  );
}
