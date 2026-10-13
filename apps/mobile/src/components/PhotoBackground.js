import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A destination photo behind content, with a dark scrim so white text on top passes contrast.
 * scrim: 'full' (even) | 'bottom' (darker towards the bottom, for headlines over the sky).
 */
export function PhotoBackground({ source, children, style, scrim = 'full', lowData = false }) {
  const { c } = useTheme();
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: c.primary }, style]}>
      <Image
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={lowData ? 0 : 200}
        accessible={false}
        accessibilityIgnoresInvertColors
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim, opacity: scrim === 'full' ? 1 : 0.85 }]} />
      {children}
    </View>
  );
}
