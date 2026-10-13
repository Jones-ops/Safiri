import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

/** A question that opens to show its answer. */
export function FaqItem({ q, a }) {
  const { c, radius, space } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={{ backgroundColor: c.surface, borderRadius: radius.input, padding: space.lg, gap: space.sm, minHeight: 48 }}
    >
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <AppText variant="body" style={{ flex: 1, fontWeight: '600' }}>
          {q}
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
      </View>
      {open ? <AppText variant="body" tone="textMuted">{a}</AppText> : null}
    </Pressable>
  );
}
