/** Bilingual privacy notice (Kenya Data Protection Act 2019). Text must be reviewed by counsel before launch. */
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';

const SECTIONS = [
  ['privacy.whatTitle', 'privacy.what'],
  ['privacy.shareTitle', 'privacy.share'],
  ['privacy.rightsTitle', 'privacy.rights'],
];

export default function Privacy() {
  const { space } = useTheme();
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
      <AppText variant="body">{t('privacy.intro')}</AppText>
      {SECTIONS.map(([title, body]) => [
        <AppText key={title} variant="heading" accessibilityRole="header" style={{ marginTop: space.md }}>
          {t(title)}
        </AppText>,
        <AppText key={body} variant="body">
          {t(body)}
        </AppText>,
      ])}
      <AppText variant="label" tone="textMuted" style={{ marginTop: space.md }}>
        {t('privacy.contact')}
      </AppText>
    </ScrollView>
  );
}
