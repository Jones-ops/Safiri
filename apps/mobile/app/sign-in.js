/** Sign in step 1: email. Supabase emails a 6-digit code. */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { EVENTS, emailSchema, z } from '@safiri/shared';
import { AppText, Button, EmailInput } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';
import { isSupabaseConfigured, supabase } from '../src/lib/supabase';
import { currentLanguage } from '../src/i18n';
import { track } from '../src/analytics';

const formSchema = z.object({ email: emailSchema });

export default function SignIn() {
  const { space } = useTheme();
  const { t } = useTranslation();
  const [serverError, setServerError] = useState(null);
  const { control, handleSubmit, formState } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setServerError(null);
    if (!isSupabaseConfigured) {
      setServerError('common.notConfigured');
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { data: { language: currentLanguage() } }, // saved on the new profile
    });
    if (error) {
      setServerError(error.status ? 'errors.generic' : 'errors.network');
      return;
    }
    track(EVENTS.OTP_REQUESTED);
    router.push({ pathname: '/verify', params: { email } });
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }} keyboardShouldPersistTaps="handled">
        <AppText variant="body" tone="textMuted">
          {t('auth.emailHint')}
        </AppText>
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <EmailInput
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
