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
    async sendTemplate({ to, template, language, params }) {
      if (!configured) throw new Error('WhatsApp is not configured');
      const res = await fetchImpl(`${GRAPH}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: template,
            language: { code: language },
            components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }],
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || `WhatsApp returned HTTP ${res.status}`);
      return { id: data.messages?.[0]?.id || null };
    },
  };
}

module.exports = { createWhatsApp };
