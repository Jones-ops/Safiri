/** Photo credits. CC BY and CC BY-SA require naming the photographer and the licence. */
import { Linking, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText, ListRow } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';
import { photoCredits } from '../src/assets/photos';

export default function Credits() {
  const { space } = useTheme();
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.sm }}>
      <AppText variant="body" tone="textMuted">
        {t('credits.intro')}
      </AppText>
      {photoCredits.map((p) => (
        <ListRow
          key={p.file}
          icon="image-outline"
          label={`${p.place} · ${t('credits.by', { name: p.author })}`}
          value={p.licence}
          onPress={() => Linking.openURL(p.url)}
        />
      ))}
    </ScrollView>
  );
}
