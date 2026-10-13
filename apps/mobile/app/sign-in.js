/** Sign in step 1: phone number. Supabase sends a 6-digit code by SMS (via our API hook). */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { EVENTS, msisdnSchema, toE164, z } from '@safiri/shared';
import { AppText, Button, PhoneInput } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';
import { isSupabaseConfigured, supabase } from '../src/lib/supabase';
import { currentLanguage } from '../src/i18n';
import { track } from '../src/analytics';

const formSchema = z.object({ phone: msisdnSchema });

export default function SignIn() {
  const { space } = useTheme();
  const { t } = useTranslation();
  const [serverError, setServerError] = useState(null);
  const { control, handleSubmit, formState } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { phone: '' },
  });

  const onSubmit = handleSubmit(async ({ phone }) => {
    setServerError(null);
    if (!isSupabaseConfigured) {
      setServerError('common.notConfigured');
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      phone: toE164(phone),
      options: { data: { language: currentLanguage() } }, // lets the SMS hook text in the right language
    });
    if (error) {
      setServerError(error.status ? 'errors.generic' : 'errors.network');
      return;
    }
    track(EVENTS.OTP_REQUESTED);
    router.push({ pathname: '/verify', params: { phone } });
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }} keyboardShouldPersistTaps="handled">
        <AppText variant="body" tone="textMuted">
          {t('auth.phoneHint')}
        </AppText>
        <Controller
          control={control}
          name="phone"
          render={({ field, fieldState }) => (
            <PhoneInput
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error ? `errors.${fieldState.error.message}` : null}
              autoFocus
            />
          )}
        />
        {serverError ? (
          <AppText variant="label" tone="danger" accessibilityLiveRegion="assertive">
            {t(serverError)}
          </AppText>
        ) : null}
        <View>
          <Button label={t('auth.sendCode')} onPress={onSubmit} loading={formState.isSubmitting} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
