/** Profile: account, language, data saver, privacy rights, credits. */
import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EVENTS } from '@safiri/shared';
import { AppText, Button, ListRow, SegmentedControl, SwitchRow } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSession } from '../../src/features/auth/session';
import { syncAfterSignIn } from '../../src/features/auth/sync';
import { supabase } from '../../src/lib/supabase';
import { api } from '../../src/lib/api';
import { formatMsisdn } from '../../src/lib/format';
import { useSettings } from '../../src/state/settings';
import { currentLanguage } from '../../src/i18n';
import { track } from '../../src/analytics';

export default function Profile() {
  const { space } = useTheme();
  const { t } = useTranslation();
  const { session } = useSession();
  const { lowData, setLowData, setLanguage } = useSettings();
  const language = currentLanguage();

  // Goes through the API, proving app -> API -> Supabase auth works end to end.
  const me = useQuery({ queryKey: ['me', session?.user.id], queryFn: () => api('/v1/me'), enabled: Boolean(session) });
  const phone = me.data?.phone || session?.user.phone;

  const saveToAccount = () => {
    if (session) syncAfterSignIn(session.user.id).catch(() => {});
  };

  const comingSoon = () => Alert.alert(t('profile.title'), t('profile.comingSoon'));

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <AppText variant="body" tone="textMuted">
          {session ? t('profile.signedInAs', { phone: formatMsisdn(phone) }) : t('profile.notSignedIn')}
        </AppText>
        {!session ? <Button label={t('profile.signIn')} icon="call-outline" onPress={() => router.push('/sign-in')} /> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <AppText variant="label">{t('profile.language')}</AppText>
        <SegmentedControl
          accessibilityLabel={t('profile.language')}
          value={language}
          onChange={(value) => {
            setLanguage(value);
            track(EVENTS.LANGUAGE_CHANGED, { language: value });
            saveToAccount();
          }}
          options={[
            { value: 'en', label: 'English' },
            { value: 'sw', label: 'Kiswahili' },
          ]}
        />
        <SwitchRow
          label={t('profile.lowData')}
          hint={t('welcome.lowDataHint')}
          value={lowData}
          onChange={(value) => {
            setLowData(value);
            track(EVENTS.LOW_DATA_CHANGED, { lowData: value });
            saveToAccount();
          }}
        />
      </View>

      <View>
        <ListRow icon="notifications-outline" label={t('profile.notifications')} onPress={comingSoon} />
        <ListRow icon="shield-outline" label={t('profile.privacy')} onPress={() => router.push('/privacy')} />
        <ListRow icon="download-outline" label={t('profile.downloadData')} onPress={comingSoon} />
        <ListRow icon="trash-outline" label={t('profile.deleteAccount')} tone="danger" onPress={comingSoon} />
      </View>

      <View>
        <AppText variant="label" tone="textMuted" style={{ marginBottom: space.xs }}>
          {t('profile.about')}
        </AppText>
        <ListRow icon="camera-outline" label={t('profile.photoCredits')} onPress={() => router.push('/credits')} />
        {__DEV__ ? (
          <ListRow icon="color-palette-outline" label={t('profile.designSystem')} onPress={() => router.push('/design-system')} />
        ) : null}
      </View>

      {session ? <Button label={t('auth.signOut')} variant="secondary" onPress={() => supabase.auth.signOut()} /> : null}
    </ScrollView>
  );
}
