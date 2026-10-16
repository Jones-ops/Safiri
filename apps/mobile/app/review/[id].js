/**
 * Post-trip review: stars, a few words, and photos or a clip. Uploads are resumable; written
 * offline, the review waits on the phone and posts when the connection returns.
 */
import { useState } from 'react';
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { maxFontScale, touchTarget } from '../../src/theme/tokens';
import { useIsOnline } from '../../src/lib/network';
import { useSession } from '../../src/features/auth/session';
import { usePostReview } from '../../src/features/account/api';
import { pathsFor, uploadAll } from '../../src/features/review/upload';
import { pendingReviews } from '../../src/features/review/queue';

function Stars({ value, onChange }) {
  const { c, space } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityRole="radiogroup" accessibilityLabel={t('review.rating')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n)}
          accessibilityRole="radio"
          accessibilityState={{ checked: n === value }}
          accessibilityLabel={`${n}/5`}
          style={{ width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={32} color={n <= value ? c.warning : c.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

export default function Review() {
  const { id } = useLocalSearchParams();
  const { c, radius, space, type } = useTheme();
  const { t } = useTranslation();
  const online = useIsOnline();
  const { session } = useSession();
  const post = usePostReview();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [assets, setAssets] = useState([]);
  const [progress, setProgress] = useState(null);
  const [state, setState] = useState(null); // posted | queued | error code
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 6 - assets.length, quality: 0.8, videoMaxDuration: 60,
    });
    if (!result.canceled) setAssets((a) => [...a, ...result.assets].slice(0, 6));
  };

  const submit = async () => {
    if (!session) return;
    const mediaPaths = pathsFor(session.user.id, assets);
    if (!online) {
      pendingReviews.add({ bookingId: id, rating, body, assets: assets.map((a) => ({ uri: a.uri, type: a.type, mimeType: a.mimeType })), mediaPaths });
      setState('queued');
      return;
    }
    setBusy(true);
    try {
      if (assets.length) await uploadAll(assets, mediaPaths, setProgress);
      await post.mutateAsync({ bookingId: id, rating, body, mediaPaths });
      setState('posted');
    } catch (err) {
      if (err.code === 'already_reviewed') setState('already');
      else if (err.code === 'not_reviewable') setState('notYet');
      else if (err.offline) {
        pendingReviews.add({ bookingId: id, rating, body, assets: assets.map((a) => ({ uri: a.uri, type: a.type, mimeType: a.mimeType })), mediaPaths });
        setState('queued');
      } else setState('error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (state === 'posted' || state === 'queued' || state === 'already' || state === 'notYet') {
    const icon = { posted: 'checkmark-circle-outline', queued: 'cloud-upload-outline', already: 'checkmark-done-outline', notYet: 'time-outline' }[state];
    return <EmptyState icon={icon} title={t(`review.${state}`)} action={{ label: t('trips.title'), onPress: () => router.replace('/trips') }} />;
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space.sm }}>
        <AppText variant="label">{t('review.rating')}</AppText>
        <Stars value={rating} onChange={setRating} />
      </View>

      <View style={{ gap: space.xs }}>
        <AppText variant="label">{t('review.body')}</AppText>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={2000}
          maxFontSizeMultiplier={maxFontScale}
          accessibilityLabel={t('review.body')}
          placeholderTextColor={c.textMuted}
          style={[type.body, { minHeight: 120, padding: space.md, color: c.text, backgroundColor: c.surface, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.input, textAlignVertical: 'top' }]}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Button label={t('review.addPhotos')} icon="images-outline" variant="secondary" onPress={pick} disabled={assets.length >= 6 || busy} />
        {assets.length ? (
          <ScrollView horizontal contentContainerStyle={{ gap: space.sm }} showsHorizontalScrollIndicator={false}>
            {assets.map((a, i) => (
              <Pressable key={a.uri} onPress={() => setAssets((list) => list.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={t('agency.removeItem')}>
                <Image source={{ uri: a.uri }} style={{ width: 88, height: 88, borderRadius: radius.input, backgroundColor: c.surface }} />
                {a.type === 'video' ? <Ionicons name="videocam" size={18} color={c.onPrimary} style={{ position: 'absolute', left: 6, bottom: 6 }} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {assets.length ? <AppText variant="caption" tone="textMuted">{t('review.photos', { n: assets.length })}</AppText> : null}
      </View>

      {progress !== null ? <AppText variant="label" tone="primary" accessibilityLiveRegion="polite">{t('review.uploading', { pct: Math.round(progress * 100) })}</AppText> : null}
      {state === 'error' ? <AppText variant="body" tone="danger">{t('errors.generic')}</AppText> : null}
      {!online ? <AppText variant="caption" tone="textMuted">{t('review.queued')}</AppText> : null}

      <Button label={t('review.post')} icon="send-outline" onPress={submit} loading={busy} disabled={!rating || busy} />
    </ScrollView>
  );
}
