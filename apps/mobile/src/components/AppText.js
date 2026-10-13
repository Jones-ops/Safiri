import { Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { maxFontScale } from '../theme/tokens';

/**
 * All text in the app. variant: display | title | heading | body | label | caption.
 * tone: a colour token name (text, textMuted, primary, danger...). tabular: fixed-width digits for prices.
 */
export function AppText({ variant = 'body', tone = 'text', tabular, style, children, ...rest }) {
  const { c, type } = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={maxFontScale}
      style={[type[variant], { color: c[tone] ?? tone }, tabular && { fontVariant: ['tabular-nums'] }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}
