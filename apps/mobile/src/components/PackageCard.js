import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { PriceTag } from './PriceTag';
import { InstalmentBadge } from './InstalmentBadge';

/**
 * A package in a list. Poster first: video never autoplays; with a clip, a play mark shows
 * and the clip loads only when tapped (Slice 1 adds the player).
 * pkg: { title, destinationName, nights, fromPriceKes, instalments: { times, amountKes } | null }
 */
export function PackageCard({ pkg, posterSource, videoUri, lowData = false, onPress }) {
  const { c, radius, space, elevation } = useTheme();
  const { t } = useTranslation();
  const nightsLabel =
    pkg.nights === 0 ? t('pkg.dayTrip') : pkg.nights === 1 ? t('pkg.oneNight') : t('pkg.nights', { n: pkg.nights });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${pkg.title}, ${pkg.destinationName}, ${nightsLabel}`}
      style={({ pressed }) => [
        { backgroundColor: c.surface, borderRadius: radius.card, overflow: 'hidden', opacity: pressed ? 0.92 : 1 },
        elevation.card,
      ]}
    >
      <View>
        <Image
          source={posterSource}
          style={styles.poster}
          contentFit="cover"
          // Data saver: skip the fade and let expo-image pick the smallest cached size.
          transition={lowData ? 0 : 150}
          accessibilityIgnoresInvertColors
        />
        {videoUri ? (
          <View style={[styles.play, { backgroundColor: c.scrim, borderRadius: radius.chip }]}>
            <Ionicons name="play" size={18} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <AppText variant="caption" tone="textMuted">
          {pkg.destinationName} · {nightsLabel}
        </AppText>
        <AppText variant="heading" numberOfLines={2}>
          {pkg.title}
        </AppText>
        <PriceTag totalKes={pkg.fromPriceKes} instalments={pkg.instalments} />
        {pkg.instalments ? <InstalmentBadge count={pkg.instalments.times} amountKes={pkg.instalments.amountKes} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  poster: { width: '100%', aspectRatio: 16 / 9 },
  play: { position: 'absolute', right: 12, bottom: 12, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
