/**
 * Every core component with sample data, for design review on a real phone (developer builds
 * only; reached from Profile). Follows the phone's light/dark setting. Sample content uses
 * the plan's worked example: KES 15,700 per person, or 4 x 3,925.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  AppText,
  Button,
  Checkbox,
  DayPlanItem,
  EmptyState,
  InstalmentBadge,
  MemberPaidChip,
  MpesaPromptSheet,
  OfflineBanner,
  PackageCard,
  PaymentStatusRow,
  PhoneInput,
  PriceTag,
  SegmentedControl,
  Skeleton,
  StickyPriceBar,
  SwitchRow,
  VerifiedBadge,
} from '../src/components';
import { STATUS_KEYS, StatusLabel } from '../src/components/StatusLabel';
import { useTheme } from '../src/theme/ThemeProvider';
import { colors } from '../src/theme/tokens';
import { bundledPhotos } from '../src/assets/photos';

const MPESA_STATES = ['sending', 'waiting', 'paid', 'failed', 'timed_out'];
const SAMPLE_PKG = {
  title: 'Naivasha lakeside weekend',
  destinationName: 'Naivasha',
  nights: 2,
  fromPriceKes: 15700,
  instalments: { times: 4, amountKes: 3925 },
};

function Section({ title, children }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

export default function DesignSystem() {
  const { c, scheme, space, radius } = useTheme();
  const { t } = useTranslation();
  const [sheet, setSheet] = useState(null);
  const [checked, setChecked] = useState(true);
  const [toggle, setToggle] = useState(false);
  const [phone, setPhone] = useState('0712 345 678');
  const [seg, setSeg] = useState('en');

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xxl, paddingBottom: space.xxxl }}>
        <AppText variant="body" tone="textMuted">
          {t('designSystem.note')} ({scheme})
        </AppText>

        <Section title="Colour">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {Object.entries(colors[scheme]).map(([name, value]) => (
              <View key={name} style={{ width: 96, gap: space.xs }}>
                <View style={{ height: 40, borderRadius: radius.input, backgroundColor: value, borderWidth: 1, borderColor: c.divider }} />
                <AppText variant="caption">{name}</AppText>
                <AppText variant="caption" tone="textMuted">
                  {value}
                </AppText>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Type">
          {['display', 'title', 'heading', 'body', 'label', 'caption'].map((v) => (
            <AppText key={v} variant={v}>
              {v} · KES 15,700
            </AppText>
          ))}
        </Section>

        <Section title="Price">
          <PriceTag totalKes={15700} instalments={{ times: 4, amountKes: 3925 }} size="lg" />
          <PriceTag totalKes={8100} />
          <InstalmentBadge count={4} amountKes={3925} />
        </Section>

        <Section title="PackageCard">
          <PackageCard pkg={SAMPLE_PKG} posterSource={bundledPhotos.explore} videoUri="sample.mp4" onPress={() => {}} />
        </Section>

        <Section title="Status">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
            {STATUS_KEYS.map((s) => (
              <StatusLabel key={s} status={s} />
            ))}
          </View>
          <View>
            <PaymentStatusRow label="Deposit" amountKes={3925} dueDate="2026-10-13" status="paid" />
            <PaymentStatusRow label="Instalment 1" amountKes={3925} dueDate="2026-10-29" status="due_soon" />
            <PaymentStatusRow label="Instalment 2" amountKes={3925} dueDate="2026-11-14" status="due" />
            <PaymentStatusRow label="Instalment 3" amountKes={3925} dueDate="2026-10-01" status="overdue" />
          </View>
          <MemberPaidChip name="Otieno" shareKes={52550} status="paid" />
          <MemberPaidChip name="Achieng" shareKes={52550} status="not_paid" />
        </Section>

        <Section title="Trust and itinerary">
          <VerifiedBadge licenceNo="TRA/AC/2025/1187" verifiedAt="2026-09-02T09:00:00Z" />
          <DayPlanItem day="Day 1" time="07:00" title="Shuttle from Nairobi" items={['Pick-up at Westlands', 'About 2 hours']} />
          <DayPlanItem day="Day 2" time="10:00" title="Boat ride to Crescent Island" items={['Life jackets provided']} />
        </Section>

        <Section title="Forms">
          <PhoneInput value={phone} onChange={setPhone} />
          <PhoneInput value="0201234567" onChange={() => {}} error="errors.phone.invalid" />
          <Checkbox checked={checked} onChange={setChecked} label={t('welcome.consent.notifications')} />
          <SwitchRow label={t('welcome.lowData')} hint={t('welcome.lowDataHint')} value={toggle} onChange={setToggle} />
          <SegmentedControl value={seg} onChange={setSeg} options={[{ value: 'en', label: 'English' }, { value: 'sw', label: 'Kiswahili' }]} />
        </Section>

        <Section title="Buttons">
          <Button label={t('price.bookNow')} />
          <Button label={t('price.splitWithFriends')} variant="secondary" icon="people-outline" />
          <Button label={t('auth.changeNumber')} variant="ghost" />
          <Button label={t('common.loading')} loading />
          <Button label={t('common.continue')} disabled />
        </Section>

        <Section title="M-PESA sheet">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {MPESA_STATES.map((s) => (
              <Button key={s} label={s} variant="secondary" onPress={() => setSheet(s)} />
            ))}
          </View>
        </Section>

        <Section title="Loading, empty, offline">
          <Skeleton variant="card" />
          <OfflineBanner savedAt={new Date(Date.now() - 2 * 3600 * 1000).toISOString()} />
          <OfflineBanner offline />
          <EmptyState title={t('trips.emptyTitle')} body={t('trips.emptyBody')} action={{ label: t('trips.emptyAction'), onPress: () => {} }} />
        </Section>
      </ScrollView>

      <StickyPriceBar totalKes={15700} instalments={{ times: 4, amountKes: 3925 }} ctaLabel={t('price.bookNow')} onCta={() => setSheet('waiting')} />

      <MpesaPromptSheet
        visible={Boolean(sheet)}
        phone="254712345678"
        amountKes={3925}
        status={sheet || 'waiting'}
        onRetry={() => setSheet('waiting')}
        onChangeNumber={() => setSheet(null)}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}
