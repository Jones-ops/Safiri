/** Profile: account, mode, language, data saver, referral, privacy rights (export, delete), credits. */
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import { EVENTS } from '@safiri/shared';
import { AppText, Button, ListRow, SegmentedControl, SwitchRow } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSession } from '../../src/features/auth/session';
import { syncAfterSignIn } from '../../src/features/auth/sync';
import { deleteMyAccount, exportMyData, useMyProviders, useStaff } from '../../src/features/account/api';
import { supabase } from '../../src/lib/supabase';
import { api } from '../../src/lib/api';
import { useSettings } from '../../src/state/settings';
import { currentLanguage } from '../../src/i18n';
import { track } from '../../src/analytics';

const MODE_HOME = { traveller: '/explore', provider: '/requests', agency: '/packages' };

export default function Profile() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const { session } = useSession();
  const { lowData, setLowData, setLanguage, mode, setMode } = useSettings();
  const language = currentLanguage();
  const [busy, setBusy] = useState(null);

  // Goes through the API, proving app -> API -> Supabase auth works end to end.
  const me = useQuery({ queryKey: ['me', session?.user.id], queryFn: () => api('/v1/me'), enabled: Boolean(session) });
  const staff = useStaff();
  const providers = useMyProviders();
  const email = me.data?.email || session?.user.email;

  const isProvider = (providers.data || []).length > 0;
  const isAgency = Boolean(staff.data?.admin || staff.data?.agencies?.length);
  const modes = [
    { value: 'traveller', label: t('modes.traveller') },
    ...(isProvider ? [{ value: 'provider', label: t('modes.provider') }] : []),
    ...(isAgency ? [{ value: 'agency', label: t('modes.agency') }] : []),
  ];

  const saveToAccount = () => {
    if (session) syncAfterSignIn(session.user.id).catch(() => {});
  };

  const switchMode = (value) => {
    setMode(value);
    router.replace(MODE_HOME[value]);
  };

  const exportData = async () => {
    setBusy('export');
    try {
      const data = await exportMyData();
      const file = new File(Paths.cache, 'safiri-my-data.json');
      file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: t('profile.export') });
      else Alert.alert(t('profile.export'), t('profile.exportReady'));
    } catch (err) {
      Alert.alert(t('profile.export'), err.offline ? t('errors.network') : t('errors.generic'));
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = () => {
    Alert.alert(t('profile.deleteTitle'), t('profile.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.deleteConfirm'),
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await deleteMyAccount();
            await supabase.auth.signOut();
            Alert.alert(t('profile.deleteTitle'), t('profile.deleted'));
          } catch (err) {
            Alert.alert(t('profile.deleteTitle'), err.offline ? t('errors.network') : t('errors.generic'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <AppText variant="body" tone="textMuted">
          {session ? t('profile.signedInAs', { email }) : t('profile.notSignedIn')}
        </AppText>
        {!session ? <Button label={t('profile.signIn')} icon="mail-outline" onPress={() => router.push('/sign-in')} /> : null}
      </View>

      {session ? (
        <View style={{ gap: space.sm }}>
          <AppText variant="label">{t('profile.mode')}</AppText>
          {modes.length > 1 ? <SegmentedControl accessibilityLabel={t('modes.switch')} value={mode} onChange={switchMode} options={modes} /> : null}
          {!isProvider ? (
            <ListRow icon="storefront-outline" label={t('modes.becomeProvider')} onPress={() => router.push('/provider/onboard')} />
          ) : null}
          {!isProvider ? <AppText variant="caption" tone="textMuted">{t('modes.becomeProviderHint')}</AppText> : null}
        </View>
      ) : null}

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

      {session ? (
        <View style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: c.primarySoft, gap: space.sm }}>
          <AppText variant="heading">{t('review.referralTitle', { amount: 500 })}</AppText>
          <AppText variant="body" tone="textMuted">{t('review.referralBody', { amount: 'KES 500' })}</AppText>
          <Button label={t('review.share')} icon="gift-outline" variant="secondary" onPress={() => router.push('/referral')} />
        </View>
      ) : null}

      <View>
        <ListRow icon="shield-outline" label={t('profile.privacy')} onPress={() => router.push('/privacy')} />
        {session ? <ListRow icon="download-outline" label={busy === 'export' ? t('common.loading') : t('profile.export')} onPress={busy ? undefined : exportData} /> : null}
        {session ? <ListRow icon="trash-outline" label={t('profile.deleteTitle')} tone="danger" onPress={busy ? undefined : deleteAccount} /> : null}
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
