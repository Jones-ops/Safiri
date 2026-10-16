/**
 * Welcome (first run only, no sign-up): language, data saver, and consent per purpose.
 * Only the booking consent is required; analytics stays off unless ticked.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CONSENT_PURPOSES, EVENTS, REQUIRED_CONSENTS } from '@safiri/shared';
import { AppText, Button, Checkbox, PhotoBackground, SegmentedControl, SwitchRow } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';
import { useSettings } from '../src/state/settings';
import { currentLanguage } from '../src/i18n';
import { setAnalyticsConsent, track } from '../src/analytics';
import { bundledPhotos } from '../src/assets/photos';

export default function Welcome() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { consents, lowData, setConsent, setLowData, setLanguage, completeWelcome } = useSettings();
  const [showRequired, setShowRequired] = useState(false);
  const language = currentLanguage();
  const canContinue = REQUIRED_CONSENTS.every((p) => consents[p]);

  const onContinue = () => {
    if (!canContinue) {
      setShowRequired(true);
      return;
    }
    if (!useSettings.getState().language) setLanguage(language); // remember the choice shown
    completeWelcome();
    setAnalyticsConsent(consents.analytics);
    track(EVENTS.WELCOME_COMPLETED, { language, lowData, analytics: consents.analytics });
    router.replace('/sign-in'); // signed in already: the root layout moves on to Explore
  };

  return (
    <PhotoBackground source={bundledPhotos.welcome} style={{ flex: 1 }} scrim="bottom" lowData={lowData}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: insets.top + space.xxxl }}>
        <View style={{ paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.sm }}>
          <AppText variant="label" tone="#FFFFFF" style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
            Safiri
          </AppText>
          <AppText variant="display" tone="#FFFFFF" accessibilityRole="header">
            {t('welcome.title')}
          </AppText>
          <AppText variant="body" tone="#FFFFFF">
            {t('welcome.subtitle')}
          </AppText>
        </View>

        <View
          style={{
            backgroundColor: c.surface,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            padding: space.xl,
            paddingBottom: space.xl + insets.bottom,
            gap: space.lg,
          }}
        >
          <View style={{ gap: space.sm }}>
            <AppText variant="label">{t('welcome.language')}</AppText>
            <SegmentedControl
              accessibilityLabel={t('welcome.language')}
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'en', label: 'English' },
                { value: 'sw', label: 'Kiswahili' },
              ]}
            />
          </View>

          <SwitchRow label={t('welcome.lowData')} hint={t('welcome.lowDataHint')} value={lowData} onChange={setLowData} />

          <View>
            <AppText variant="heading" style={{ marginBottom: space.xs }}>
              {t('welcome.consentTitle')}
            </AppText>
            {Object.values(CONSENT_PURPOSES).map((purpose) => (
              <Checkbox
                key={purpose}
                checked={consents[purpose]}
                onChange={(v) => {
                  setConsent(purpose, v);
                  if (v) setShowRequired(false);
                }}
                label={t(`welcome.consent.${purpose}`)}
                required={REQUIRED_CONSENTS.includes(purpose)}
              />
            ))}
            <Button label={t('welcome.privacyLink')} variant="ghost" onPress={() => router.push('/privacy')} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
          </View>

          {showRequired ? (
            <AppText variant="label" tone="danger" accessibilityLiveRegion="assertive">
              {t('welcome.consentRequired')}
            </AppText>
          ) : null}
          <Button label={t('common.continue')} onPress={onContinue} />
        </View>
      </ScrollView>
    </PhotoBackground>
  );
}
