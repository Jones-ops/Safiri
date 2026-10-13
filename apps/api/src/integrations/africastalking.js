/**
 * Africa's Talking SMS (OTP codes now; payment-reminder fallback later).
 * Uses the REST API directly: one endpoint, no SDK needed.
 */

const ENDPOINTS = {
  sandbox: 'https://api.sandbox.africastalking.com/version1/messaging',
  live: 'https://api.africastalking.com/version1/messaging',
};

/**
 * @param {{ username?:string, apiKey?:string, senderId?:string, log:object, devMode:boolean }} options
 * In dev mode with no credentials, messages are written to the log instead of sent.
 */
function createSmsClient({ username, apiKey, senderId, log, devMode, fetchImpl = fetch }) {
  const configured = Boolean(username && apiKey);
  const url = username === 'sandbox' ? ENDPOINTS.sandbox : ENDPOINTS.live;

  return {
    configured,

    /** @param {string} to E.164 number, e.g. +254712345678 */
    async send(to, message) {
      if (!configured) {
        if (!devMode) throw new Error("Africa's Talking is not configured");
        log.warn({ to, message }, 'SMS not sent (no AT_USERNAME / AT_API_KEY); dev mode logs it instead');
        return { id: 'dev-log', status: 'logged' };
      }

      const body = new URLSearchParams({ username, to, message });
      if (senderId) body.set('from', senderId);
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Africa's Talking returned HTTP ${res.status}`);

      const data = await res.json();
      const recipient = data?.SMSMessageData?.Recipients?.[0];
      // statusCode 100-102 = processed / sent / queued.
      if (!recipient || recipient.statusCode > 102) {
        throw new Error(`SMS to ${to} failed: ${recipient?.status || data?.SMSMessageData?.Message || 'no recipient'}`);
      }
      return { id: recipient.messageId, status: recipient.status };
    },
  };
}

module.exports = { createSmsClient };
