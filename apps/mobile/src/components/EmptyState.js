import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Button } from './Button';

/** No blank screens: every empty or failed state says what happened and what to do next. */
export function EmptyState({ icon = 'compass-outline', title, body, action, tone = 'primary' }) {
  const { c, space } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.xxxl, gap: space.md }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: tone === 'danger' ? c.surface : c.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={36} color={c[tone]} />
      </View>
      <AppText variant="heading" style={{ textAlign: 'center' }} accessibilityRole="header">
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" tone="textMuted" style={{ textAlign: 'center' }}>
          {body}
        </AppText>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}
