import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { PriceTag } from './PriceTag';
import { Button } from './Button';

/** Price and the one primary action, fixed to the bottom of the screen, within thumb reach. */
export function StickyPriceBar({ totalKes, perPerson = true, instalments, ctaLabel, onCta, loading, disabled }) {
  const { c, space, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          backgroundColor: c.surface,
          borderTopWidth: 1,
          borderTopColor: c.divider,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: space.md + insets.bottom,
        },
        elevation.sheet,
      ]}
    >
      <View style={{ flex: 1 }}>
        <PriceTag totalKes={totalKes} perPerson={perPerson} instalments={instalments} />
      </View>
      <Button label={ctaLabel} onPress={onCta} loading={loading} disabled={disabled} />
    </View>
  );
}
