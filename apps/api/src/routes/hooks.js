/**
 * Supabase Auth "Send SMS" hook. Supabase calls this with the OTP for a phone sign-in;
 * we send it through Africa's Talking. Requests are signed (Standard Webhooks) and verified
 * against SEND_SMS_HOOK_SECRET before anything is sent.
 */
const crypto = require('node:crypto');
const { Webhook } = require('standardwebhooks');
const { parseButtonReplies } = require('../integrations/whatsapp');
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

async function hookRoutes(app, { config, sms, providers }) {
  // Signature checks need the exact bytes Supabase sent, so keep JSON bodies as strings here.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  const webhook = config.SEND_SMS_HOOK_SECRET
    ? new Webhook(config.SEND_SMS_HOOK_SECRET.replace(/^v1,whsec_/, ''))
    : null;

  // WhatsApp Cloud API webhook. Meta checks the verify token once (GET), then posts events
  // signed with the app secret over the raw body. Button taps on provider requests land here.
  app.get('/hooks/whatsapp', async (request, reply) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = request.query;
    if (mode === 'subscribe' && config.WHATSAPP_VERIFY_TOKEN && token === config.WHATSAPP_VERIFY_TOKEN) return reply.type('text/plain').send(challenge);
    return reply.code(403).send('Forbidden');
  });

  app.post('/hooks/whatsapp', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!config.WHATSAPP_APP_SECRET) return reply.code(404).send({ error: 'not_configured' });
    const expected = 'sha256=' + crypto.createHmac('sha256', config.WHATSAPP_APP_SECRET).update(request.body || '').digest('hex');
    const given = String(request.headers['x-hub-signature-256'] || '');
    if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return reply.code(401).send({ error: 'bad_signature' });
    }
    let body;
    try {
      body = JSON.parse(request.body);
    } catch {
      return reply.code(400).send({ error: 'bad_json' });
    }
    for (const tap of parseButtonReplies(body)) {
      const [action, code] = String(tap.payload).split(':');
      if (!['accept', 'decline'].includes(action)) continue;
      const target = await providers.requestByCode(code);
      // The tap must come from the provider's own WhatsApp number.
      if (!target || target.ownerPhone !== tap.from) continue;
      await providers.respond({ firstItemId: target.firstItemId, accept: action === 'accept' }).catch((err) =>
        request.log.warn({ err, code }, 'WhatsApp reply could not be applied'));
    }
    return { ok: true };
  });

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
