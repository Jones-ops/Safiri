/**
 * Supabase Auth "Send SMS" hook. Supabase calls this with the OTP for a phone sign-in;
 * we send it through Africa's Talking. Requests are signed (Standard Webhooks) and verified
 * against SEND_SMS_HOOK_SECRET before anything is sent.
 */
const { Webhook } = require('standardwebhooks');
const { normalizeMsisdn, toE164 } = require('@safiri/shared');

const MESSAGES = {
  en: (otp) => `Safiri: your code is ${otp}. It expires in 10 minutes. Never share it, not even with Safiri staff.`,
  sw: (otp) => `Safiri: nambari yako ni ${otp}. Itaisha baada ya dakika 10. Usimpe mtu yeyote, hata wafanyakazi wa Safiri.`,
};

function otpMessage(otp, language) {
  return (MESSAGES[language] || MESSAGES.en)(otp);
}

/** Error body in the shape Supabase Auth expects from a hook. */
const hookError = (reply, httpCode, message) => reply.code(httpCode).send({ error: { http_code: httpCode, message } });

async function hookRoutes(app, { config, sms }) {
  // Signature checks need the exact bytes Supabase sent, so keep JSON bodies as strings here.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  const webhook = config.SEND_SMS_HOOK_SECRET
    ? new Webhook(config.SEND_SMS_HOOK_SECRET.replace(/^v1,whsec_/, ''))
    : null;

  app.post('/hooks/send-sms', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!webhook) {
      request.log.error('SEND_SMS_HOOK_SECRET is not set');
      return hookError(reply, 500, 'SMS hook is not configured');
    }

    let payload;
    try {
      payload = webhook.verify(request.body, {
        'webhook-id': request.headers['webhook-id'],
        'webhook-timestamp': request.headers['webhook-timestamp'],
        'webhook-signature': request.headers['webhook-signature'],
      });
    } catch {
      return hookError(reply, 401, 'Invalid signature');
    }

    const phone = normalizeMsisdn(payload?.user?.phone);
    const otp = payload?.sms?.otp;
    if (!phone) return hookError(reply, 400, 'Safiri only supports Kenyan mobile numbers');
    if (!/^\d{4,8}$/.test(String(otp || ''))) return hookError(reply, 400, 'Missing OTP');

    const language = payload.user.user_metadata?.language === 'sw' ? 'sw' : 'en';
    try {
      const result = await sms.send(toE164(phone), otpMessage(otp, language));
      request.log.info({ phone: `${phone.slice(0, 6)}***`, messageId: result.id }, 'OTP sent');
    } catch (err) {
      request.log.error({ err }, 'OTP SMS failed');
      return hookError(reply, 502, 'Could not send the code. Please try again.');
    }
    return {};
  });
}

module.exports = hookRoutes;
module.exports.otpMessage = otpMessage;
