/** Give KES 500, get KES 500: the traveller's code, a share button, and reward codes earned. */
import { ScrollView, Share, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText, Button, EmptyState, Skeleton } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatKes } from '../src/lib/format';
import { useReferral } from '../src/features/account/api';

export default function Referral() {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const referral = useReferral();

  if (referral.isPending) return <View style={{ padding: space.xl }}><Skeleton variant="block" height={160} /></View>;
  if (referral.isError) return <EmptyState icon="cloud-offline-outline" tone="danger" title={t('errors.network')} action={{ label: t('common.retry'), onPress: () => referral.refetch() }} />;
  const r = referral.data;
  const amount = formatKes(r.discountKes);

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
      <AppText variant="body" tone="textMuted">{t('review.referralBody', { amount })}</AppText>

      <View style={{ padding: space.xl, borderRadius: radius.card, backgroundColor: c.primarySoft, alignItems: 'center', gap: space.sm }}>
        <AppText variant="label" tone="textMuted">{t('review.yourCode')}</AppText>
        <AppText variant="display" tone="primary" tabular selectable accessibilityLabel={`${t('review.yourCode')}: ${r.code.split('').join(' ')}`}>{r.code}</AppText>
        <AppText variant="caption" tone="textMuted">{t('review.usesLeft', { n: r.usesLeft })}</AppText>
      </View>

      <Button
        label={t('review.share')}
        icon="share-social-outline"
        onPress={() => Share.share({ message: t('review.shareMessage', { amount: r.discountKes, code: r.code }) })}
      />

      {r.rewards.length ? (
        <View style={{ gap: space.sm }}>
          <AppText variant="heading" accessibilityRole="header">{t('review.rewards')}</AppText>
          {r.rewards.map((x) => (
            <View key={x.code} style={{ padding: space.lg, borderRadius: radius.card, backgroundColor: c.surface }}>
              <AppText variant="body" tabular selectable>{t('review.rewardCode', { amount: formatKes(x.discountKes), code: x.code })}</AppText>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
