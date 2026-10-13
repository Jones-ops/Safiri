import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatAmount, formatKes } from '../lib/format';
import { AppText } from './AppText';

/**
 * The all-in price, always with the instalment equivalent when there is one:
 * "KES 15,700 per person, or 4 x 3,925". size: sm (cards) | lg (package detail).
 * instalments: { times, amountKes } or null.
 */
export function PriceTag({ totalKes, perPerson = true, instalments, size = 'sm' }) {
  const { t } = useTranslation();
  const price = formatKes(totalKes);
  const main = perPerson ? t('price.perPerson', { amount: price }) : price;
  const split = instalments
    ? t('price.orInstalments', { times: instalments.times, amount: formatAmount(instalments.amountKes) })
    : null;

  return (
    <View accessible accessibilityLabel={split ? `${main}, ${split}` : main}>
      <AppText variant={size === 'lg' ? 'display' : 'heading'} tabular>
        {main}
      </AppText>
      {split ? (
        <AppText variant={size === 'lg' ? 'body' : 'label'} tone="textMuted" tabular>
          {split}
        </AppText>
      ) : null}
    </View>
  );
}
