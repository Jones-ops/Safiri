/**
 * Expo push notifications (https://exp.host). Tokens come from the app after sign-in.
 * A token Expo reports as DeviceNotRegistered is returned so the caller can disable it.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function createPushClient({ fetchImpl = fetch } = {}) {
  return {
    /**
     * @param {{ to: string[], title: string, body: string, data?: object }} message
     * @returns {{ sent: number, deadTokens: string[] }}
     */
    async send({ to, title, body, data }) {
      if (!to.length) return { sent: 0, deadTokens: [] };
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(to.map((token) => ({ to: token, title, body, data, sound: 'default', channelId: 'payments' }))),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Expo push returned HTTP ${res.status}`);
      const tickets = (await res.json()).data || [];
      const deadTokens = to.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
      return { sent: tickets.filter((t) => t.status === 'ok').length, deadTokens };
    },
  };
}

module.exports = { createPushClient };
