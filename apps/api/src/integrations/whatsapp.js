/**
 * WhatsApp Cloud API: approved template messages (reminders outside the 24-hour window).
 * Off until WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are set, i.e. once Meta has
 * verified the business and approved the templates listed in PAPERWORK.md.
 */
const GRAPH = 'https://graph.facebook.com/v21.0';

function createWhatsApp({ phoneNumberId, accessToken, fetchImpl = fetch }) {
  const configured = Boolean(phoneNumberId && accessToken);
  return {
    configured,
    /**
     * @param {{ to: string, template: string, language: 'en'|'sw', params: string[] }} message
     *   to: 2547XXXXXXXX; params fill the template body's {{1}}, {{2}}, ...
     */
    async sendTemplate({ to, template, language, params, buttons = [] }) {
      if (!configured) throw new Error('WhatsApp is not configured');
      // Quick-reply buttons (Accept / Decline) carry a payload that comes back in the webhook.
      const components = [
        { type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) },
        ...buttons.map((payload, index) => ({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] })),
      ];
      const res = await fetchImpl(`${GRAPH}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: { name: template, language: { code: language }, components },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || `WhatsApp returned HTTP ${res.status}`);
      return { id: data.messages?.[0]?.id || null };
    },
  };
}

/**
 * The button taps in a Cloud API webhook body: [{ from, payload }]. Template quick replies
 * arrive as type "button"; interactive messages as "interactive" with a button_reply id.
 */
function parseButtonReplies(body) {
  const replies = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        if (m.type === 'button' && m.button?.payload) replies.push({ from: m.from, payload: m.button.payload, id: m.id });
        else if (m.type === 'interactive' && m.interactive?.button_reply?.id) replies.push({ from: m.from, payload: m.interactive.button_reply.id, id: m.id });
      }
    }
  }
  return replies;
}

module.exports = { createWhatsApp, parseButtonReplies };
