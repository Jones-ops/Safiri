import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { maxFontScale, touchTarget } from '../theme/tokens';
import { AppText } from './AppText';

/**
 * Kenyan mobile number. Accepts 07.. and 01.. (and +254); the form normalises to 2547/2541
 * with msisdnSchema from packages/shared. error: an i18n key such as "errors.phone.invalid".
 */
export function PhoneInput({ value, onChange, onBlur, error, label, autoFocus }) {
  const { c, radius, space, type } = useTheme();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? c.danger : focused ? c.primary : c.inputBorder;

  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="label">{label || t('auth.phoneLabel')}</AppText>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: touchTarget,
          borderWidth: focused || error ? 2 : 1,
          borderColor,
          borderRadius: radius.input,
          backgroundColor: c.surface,
          paddingHorizontal: space.md,
        }}
      >
        <AppText variant="body" tone="textMuted" style={{ marginRight: space.sm }}>
          🇰🇪
        </AppText>
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          autoFocus={autoFocus}
          placeholder="0712 345 678"
          placeholderTextColor={c.textMuted}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={16}
          maxFontSizeMultiplier={maxFontScale}
          accessibilityLabel={label || t('auth.phoneLabel')}
          accessibilityHint={error ? t(error) : undefined}
          style={[type.body, { flex: 1, color: c.text, paddingVertical: space.sm }]}
        />
      </View>
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {t(error)}
        </AppText>
      ) : null}
    </View>
  );
}
