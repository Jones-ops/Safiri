import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

/** One stop in the itinerary: "Day 1 · 07:00  Shuttle from Nairobi" with optional detail lines. */
export function DayPlanItem({ day, title, items = [], time }) {
  const { c, space } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={[time, title, ...items].filter(Boolean).join(', ')}
      style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.md }}
    >
      <View style={{ alignItems: 'center', width: 56 }}>
        {day != null ? (
          <AppText variant="caption" tone="textMuted">
            {day}
          </AppText>
        ) : null}
        <AppText variant="label" tone="primary" tabular>
          {time || ''}
        </AppText>
      </View>
      <View style={{ flex: 1, borderLeftWidth: 2, borderLeftColor: c.primarySoft, paddingLeft: space.md, gap: space.xs }}>
        <AppText variant="body" style={{ fontWeight: '600' }}>
          {title}
        </AppText>
        {items.map((item) => (
          <AppText key={item} variant="label" tone="textMuted">
            {item}
          </AppText>
        ))}
      </View>
    </View>
  );
}
