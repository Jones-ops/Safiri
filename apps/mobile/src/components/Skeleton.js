import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Placeholder while loading. variant: line | block | circle | card. Pulses gently unless the
 * phone's Reduce Motion setting is on.
 */
export function Skeleton({ variant = 'line', width = '100%', height }) {
  const { c, radius, space, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);

  if (variant === 'card') {
    return (
      <View
        accessibilityLabel={t('common.loading')}
        style={{ backgroundColor: c.surface, borderRadius: radius.card, overflow: 'hidden', gap: space.sm }}
      >
        <Skeleton variant="block" height={180} />
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Skeleton width="40%" />
          <Skeleton width="85%" height={20} />
          <Skeleton width="55%" height={20} />
        </View>
      </View>
    );
  }

  const shape = {
    line: { width, height: height || 14, borderRadius: radius.input / 2 },
    block: { width, height: height || 120, borderRadius: 0 },
    circle: { width: height || 40, height: height || 40, borderRadius: (height || 40) / 2 },
  }[variant];

  return <Animated.View accessibilityElementsHidden style={[shape, { backgroundColor: c.skeleton, opacity }]} />;
}
