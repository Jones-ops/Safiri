/** Sign in step 2: the 6-digit code from the email. */
import { useEffect, useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EVENTS, otpSchema } from '@safiri/shared';
import { AppText, Button } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';
import { maxFontScale, touchTarget } from '../src/theme/tokens';
import { supabase } from '../src/lib/supabase';
import { track } from '../src/analytics';

const RESEND_SECONDS = 60;

export default function Verify() {
  const { c, radius, space, type } = useTheme();
  const { t } = useTranslation();
  const { email } = useLocalSearchParams();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const verify = async (value = code) => {
    if (!otpSchema.safeParse(value).success) {
      setError('errors.otp.invalid');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token: value, type: 'email' });
    setBusy(false);
    if (err) {
      setError(err.status ? 'errors.otp.wrong' : 'errors.network');
      return;
    }
    track(EVENTS.SIGNED_IN);
    router.dismissTo('/profile');
  };

  const resend = async () => {
    setWait(RESEND_SECONDS);
    const { error: err } = await supabase.auth.signInWithOtp({ email });
    if (err) setError('errors.network');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <AppText variant="body" tone="textMuted">
        {t('auth.otpHint', { email })}
      </AppText>
      <TextInput
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) verify(digits); // submit as soon as the code is complete
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoFocus
        maxLength={6}
        maxFontSizeMultiplier={maxFontScale}
        accessibilityLabel={t('auth.otpLabel')}
        placeholder="000000"
        placeholderTextColor={c.textMuted}
        style={[
          type.display,
          {
            minHeight: touchTarget + 16,
            textAlign: 'center',
            letterSpacing: 12,
            color: c.text,
            backgroundColor: c.surface,
            borderWidth: 2,
            borderColor: error ? c.danger : c.inputBorder,
            borderRadius: radius.input,
            fontVariant: ['tabular-nums'],
          },
        ]}
      />
      {error ? (
        <AppText variant="label" tone="danger" accessibilityLiveRegion="assertive">
          {t(error)}
        </AppText>
      ) : null}
      <Button label={t('auth.verify')} onPress={() => verify()} loading={busy} />
      <Button
        label={wait > 0 ? t('auth.resendIn', { seconds: wait }) : t('auth.resend')}
        variant="ghost"
        disabled={wait > 0}
        onPress={resend}
      />
      <Button label={t('auth.changeEmail')} variant="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}
