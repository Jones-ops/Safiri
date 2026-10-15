import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { maxFontScale, touchTarget } from '../theme/tokens';
import { AppText } from './AppText';

/**
 * Sign-in email. The form lower-cases and checks it with emailSchema from packages/shared.
 * error: an i18n key such as "errors.email.invalid".
 */
export function EmailInput({ value, onChange, onBlur, error, label, autoFocus }) {
  const { c, radius, space, type } = useTheme();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? c.danger : focused ? c.primary : c.inputBorder;

  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="label">{label || t('auth.emailLabel')}</AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        autoFocus={autoFocus}
        placeholder="wanjiru@gmail.com"
        placeholderTextColor={c.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        maxLength={254}
        maxFontSizeMultiplier={maxFontScale}
        accessibilityLabel={label || t('auth.emailLabel')}
        accessibilityHint={error ? t(error) : undefined}
        style={[
          type.body,
          {
            minHeight: touchTarget,
            paddingHorizontal: space.md,
            color: c.text,
            backgroundColor: c.surface,
            borderWidth: focused || error ? 2 : 1,
            borderColor,
            borderRadius: radius.input,
          },
        ]}
      />
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {t(error)}
        </AppText>
      ) : null}
    </View>
  );
}
