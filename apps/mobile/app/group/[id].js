/**
 * Group split for a held booking. Two steps on one screen:
 *   1. Set up: your name, your friends (name + M-PESA number), equal or custom shares.
 *   2. Live status: who has paid (updates within seconds), invite on WhatsApp, pay your own
 *      share, or cover a friend who doesn't pay.
 * The trip confirms once paid shares reach the deposit; friends pay from a link, no app needed.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { checkShares, msisdnSchema, splitEqually } from '@safiri/shared';
import {
  AppText, Button, EmptyState, MemberPaidChip, MpesaPromptSheet, PhoneInput, SegmentedControl, Skeleton, TextField,
} from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCountdown, formatDate, formatKes } from '../../src/lib/format';
import { api } from '../../src/lib/api';
import { useBooking } from '../../src/features/pay/api';
import { usePayFlow } from '../../src/features/pay/usePayFlow';
import { useCoverShare, useCreateSplit, useGroup } from '../../src/features/group/api';

const KNOWN = ['too_many_people', 'organiser_is_friend', 'shares_do_not_add_up', 'invalid_share', 'share_over_limit', 'not_splittable', 'already_paid', 'hold_expired', 'payment_in_progress'];
const errorKey = (err) => (KNOWN.includes(err.code) ? `group.errors.${err.code}` : err.offline ? 'errors.network' : 'errors.generic');
const codeOf = (url) => url.split('/i/')[1];

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Setup({ booking, onCreated }) {
  const { c, space } = useTheme();
  const { t } = useTranslation();
  const create = useCreateSplit(booking.bookingId);
  const [name, setName] = useState('');
  const [friends, setFriends] = useState([{ name: '', phone: '' }]);
  const [mode, setMode] = useState('equal');
  const [custom, setCustom] = useState([]);
  const [error, setError] = useState(null);
  const maxFriends = booking.travellers - 1;
  const deposit = booking.options.find((o) => o.option === 'deposit')?.amountKes ?? booking.totalKes;

  const people = friends.length + 1;
  // Same rule as the server (packages/shared): equal shares, the organiser takes the odd shillings.
  const equal = useMemo(() => splitEqually(booking.totalKes, people), [booking.totalKes, people]);
  const shares = mode === 'equal' ? equal : Array.from({ length: people }, (_, i) => Number(custom[i]) || 0);
  const sharesProblem = mode === 'custom' ? checkShares(shares, booking.totalKes) : null;
  const friendsValid = friends.every((f) => f.name.trim() && msisdnSchema.safeParse(f.phone).success);
  const canCreate = name.trim() && friendsValid && !sharesProblem && !create.isPending;

  const setFriend = (i, patch) => setFriends((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const submit = () => {
    setError(null);
    create.mutate(
      {
        organiserName: name.trim(),
        friends: friends.map((f) => ({ name: f.name.trim(), phone: msisdnSchema.parse(f.phone) })),
        ...(mode === 'custom' ? { shares } : {}),
      },
      { onSuccess: onCreated, onError: (err) => setError(errorKey(err)) },
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
      <AppText variant="body" tone="textMuted">{t('group.howItWorks', { deposit: formatKes(deposit) })}</AppText>
      <TextField label={t('group.yourName')} value={name} onChangeText={setName} />

      <View style={{ gap: space.sm }}>
        <AppText variant="heading" accessibilityRole="header">{t('group.friends')}</AppText>
        <AppText variant="caption" tone="textMuted">{t('group.maxFriends', { n: maxFriends, travellers: booking.travellers })}</AppText>
        {friends.map((f, i) => (
          <View key={i} style={{ gap: space.sm, padding: space.md, borderRadius: 12, backgroundColor: c.surface }}>
            <TextField label={t('group.friendName')} value={f.name} onChangeText={(v) => setFriend(i, { name: v })} />
            <PhoneInput value={f.phone} onChange={(v) => setFriend(i, { phone: v })}
              error={f.phone && !msisdnSchema.safeParse(f.phone).success ? 'errors.phone.invalid' : null} />
            {friends.length > 1 ? (
              <Button label={t('group.removeFriend')} variant="ghost" icon="close" onPress={() => setFriends((list) => list.filter((_, j) => j !== i))} />
            ) : null}
          </View>
        ))}
        {friends.length < maxFriends ? (
          <Button label={t('group.addFriend')} variant="secondary" icon="person-add-outline" onPress={() => setFriends((list) => [...list, { name: '', phone: '' }])} />
        ) : null}
      </View>

      <SegmentedControl value={mode} onChange={setMode} accessibilityLabel={t('group.title')}
        options={[{ value: 'equal', label: t('group.equal') }, { value: 'custom', label: t('group.custom') }]} />
      <View style={{ gap: space.sm }}>
        {[name.trim() || t('group.you'), ...friends.map((f, i) => f.name.trim() || `${t('group.friendName')} ${i + 1}`)].map((who, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <AppText variant="body" style={{ flex: 1 }}>{t('group.shareOf', { name: who })}</AppText>
            {mode === 'equal' ? (
              <AppText variant="body" tabular style={{ fontWeight: '600' }}>{formatKes(shares[i])}</AppText>
            ) : (
              <View style={{ width: 140 }}>
                <TextField value={custom[i] || ''} keyboardType="number-pad" maxLength={7} placeholder="0"
                  onChangeText={(v) => setCustom((list) => { const next = [...list]; next[i] = v.replace(/\D/g, ''); return next; })} />
              </View>
            )}
          </View>
        ))}
        {sharesProblem ? (
          <AppText variant="label" tone="danger">
            {t('group.sharesMustAddUp', { amount: formatKes(booking.totalKes), now: formatKes(shares.reduce((a, b) => a + b, 0)) })}
          </AppText>
        ) : null}
      </View>

      {error ? <AppText variant="label" tone="danger" accessibilityLiveRegion="assertive">{t(error)}</AppText> : null}
      <Button label={t('group.create')} icon="link-outline" onPress={submit} disabled={!canCreate} loading={create.isPending} />
    </ScrollView>
  );
}

function Status({ group }) {
  const { c, radius, space } = useTheme();
  const { t, i18n } = useTranslation();
  const now = useNow();
  const cover = useCoverShare(group.bookingId);
  const organiser = group.members.find((m) => m.isOrganiser);
  const myCode = codeOf(organiser.inviteUrl);
  const myLeft = organiser.shareKes - organiser.paidKes;

  const flow = usePayFlow({
    key: myCode,
    start: () => api(`/v1/invites/${myCode}/pay`, { method: 'POST', body: {} }),
    status: (paymentId) => api(`/v1/invites/${myCode}/payments/${paymentId}`),
    onError: (err) => Alert.alert(t('group.title'), t(errorKey(err))),
  });

  const invite = (m) => {
    const text = t('group.inviteMessage', { name: m.name, title: group.title || group.ref, amount: formatKes(m.shareKes - m.paidKes), link: m.inviteUrl });
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`).catch(() => {});
  };

  const confirmCover = (m) =>
    Alert.alert(t('group.cover'), t('group.coverConfirm', { amount: formatKes(m.shareKes - m.paidKes), name: m.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.continue'), onPress: () => cover.mutate(m.id, { onError: (err) => Alert.alert(t('group.title'), t(errorKey(err))) }) },
    ]);

  const held = group.status === 'held';
  const msLeft = held && group.deadline ? new Date(group.deadline).getTime() - now : 0;
  const progress = group.totalKes ? group.paidKes / group.totalKes : 0;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: space.xxxl }}>
        <View style={{ gap: space.xs }}>
          <AppText variant="caption" tone="textMuted">{t('hold.ref', { ref: group.ref })}</AppText>
          <AppText variant="title" accessibilityRole="header">{group.title}</AppText>
        </View>

        {held ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <Ionicons name="time-outline" size={18} color={msLeft < 600000 ? c.danger : c.primary} />
            <AppText variant="label" tone={msLeft < 600000 ? 'danger' : 'primary'} style={{ flex: 1 }}>
              {t('group.deadlineHold', { countdown: formatCountdown(msLeft) })}
            </AppText>
          </View>
        ) : (
          <View style={{ padding: space.md, borderRadius: radius.input, backgroundColor: c.primarySoft, gap: space.xs }}>
            <AppText variant="label" tone="primary">{t('group.confirmed')}</AppText>
            {group.deadline ? <AppText variant="caption" tone="textMuted">{t('group.deadlineFinal', { date: formatDate(group.deadline, i18n.language) })}</AppText> : null}
          </View>
        )}

        <View style={{ gap: space.xs }}>
          <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: group.totalKes, now: group.paidKes }}
            style={{ height: 8, borderRadius: 4, backgroundColor: c.primarySoft, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: c.primary }} />
          </View>
          <AppText variant="caption" tone="textMuted" tabular>{t('group.paidOf', { paid: formatKes(group.paidKes), total: formatKes(group.totalKes) })}</AppText>
          <AppText variant="caption" tone="textMuted">{t('group.live')}</AppText>
        </View>

        {group.members.map((m) => (
          <View key={m.id} style={{ gap: space.sm }}>
            <MemberPaidChip name={m.isOrganiser ? `${m.name} (${t('group.you')})` : m.name} shareKes={m.shareKes} status={m.status} />
            {!m.isOrganiser && m.status === 'not_paid' ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label={t('group.inviteWhatsApp')} icon="logo-whatsapp" variant="secondary" onPress={() => invite(m)} style={{ flex: 1 }} />
                <Button label={t('group.cover')} variant="ghost" onPress={() => confirmCover(m)} loading={cover.isPending} />
              </View>
            ) : null}
          </View>
        ))}

        {myLeft > 0 ? (
          <Button label={t('group.payMine', { amount: formatKes(myLeft) })} icon="phone-portrait-outline" onPress={flow.pay} loading={flow.busy} />
        ) : null}
        {group.status === 'confirmed' || group.status === 'fully_paid' ? (
          <Button label={t('receipt.done')} variant="ghost" onPress={() => router.navigate('/trips')} />
        ) : null}
      </ScrollView>
      <MpesaPromptSheet {...flow.sheet} phone={organiser.phone} />
    </View>
  );
}

export default function GroupSplit() {
  const { id } = useLocalSearchParams();
  const { space } = useTheme();
  const { t } = useTranslation();
  const group = useGroup(id);
  const booking = useBooking(id);

  const title = <Stack.Screen options={{ title: t('group.title') }} />;
  if (group.data) return (<>{title}<Status group={group.data} /></>);
  if (group.isPending || booking.isPending) {
    return <View style={{ padding: space.xl, gap: space.lg }}>{title}<Skeleton variant="block" height={120} /></View>;
  }
  const b = booking.data;
  if (!b || b.status !== 'held' || !b.options.length) {
    return (<>{title}<EmptyState icon="time-outline" title={t('hold.expiredTitle')} body={t('hold.expiredBody')} action={{ label: t('web.backHome'), onPress: () => router.navigate('/explore') }} /></>);
  }
  return (<>{title}<Setup booking={b} onCreated={() => group.refetch()} /></>);
}
