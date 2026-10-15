const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Webhook } = require('standardwebhooks');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { otpMessage } = require('../src/routes/hooks');

const SECRET = crypto.randomBytes(32).toString('base64');

function fakeSms() {
  const sent = [];
  return { sent, configured: true, send: async (to, message) => { sent.push({ to, message }); return { id: 'msg-1' }; } };
}

async function makeApp(overrides = {}) {
  const config = loadConfig({ NODE_ENV: 'test', SEND_SMS_HOOK_SECRET: `v1,whsec_${SECRET}` });
  return buildApp(config, {
    supabase: null,
    verifyToken: async (token) => (token === 'good-token' ? { sub: 'user-1', email: 'wanjiru@example.com' } : null),
    profiles: { getByUserId: async (id) => (id === 'user-1'
      ? { user_id: 'user-1', email: 'wanjiru@example.com', phone: null, name: 'Wanjiru', roles: ['traveller'], language: 'sw', low_data: true }
      : null) },
    ...overrides,
  });
}

/** Signs a body the way Supabase Auth signs hook calls. */
function signed(body, secret = SECRET) {
  const payload = JSON.stringify(body);
  const id = `msg_${crypto.randomUUID()}`;
  const now = new Date();
  return {
    payload,
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
      'webhook-signature': new Webhook(secret).sign(id, now, payload),
    },
  };
}

test('GET /health', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
  await app.close();
});

test('send-sms hook: a correctly signed request sends the OTP by SMS in the user\'s language', async () => {
  const sms = fakeSms();
  const app = await makeApp({ sms });
  const { payload, headers } = signed({ user: { phone: '254712345678', user_metadata: { language: 'sw' } }, sms: { otp: '482913' } });
  const res = await app.inject({ method: 'POST', url: '/hooks/send-sms', payload, headers });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(sms.sent, [{ to: '+254712345678', message: otpMessage('482913', 'sw') }]);
  assert.match(sms.sent[0].message, /nambari yako ni 482913/);
  await app.close();
});

test('send-sms hook: a bad signature is refused and nothing is sent', async () => {
  const sms = fakeSms();
  const app = await makeApp({ sms });
  const { payload, headers } = signed({ user: { phone: '254712345678' }, sms: { otp: '111111' } }, crypto.randomBytes(32).toString('base64'));
  const res = await app.inject({ method: 'POST', url: '/hooks/send-sms', payload, headers });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.http_code, 401);
  assert.equal(sms.sent.length, 0);
  await app.close();
});

test('send-sms hook: a tampered body is refused', async () => {
  const sms = fakeSms();
  const app = await makeApp({ sms });
  const { headers } = signed({ user: { phone: '254712345678' }, sms: { otp: '111111' } });
  const tampered = JSON.stringify({ user: { phone: '254799999999' }, sms: { otp: '111111' } });
  const res = await app.inject({ method: 'POST', url: '/hooks/send-sms', payload: tampered, headers });
  assert.equal(res.statusCode, 401);
  assert.equal(sms.sent.length, 0);
  await app.close();
});

test('send-sms hook: non-Kenyan numbers are refused', async () => {
  const sms = fakeSms();
  const app = await makeApp({ sms });
  const { payload, headers } = signed({ user: { phone: '255712345678' }, sms: { otp: '111111' } });
  const res = await app.inject({ method: 'POST', url: '/hooks/send-sms', payload, headers });
  assert.equal(res.statusCode, 400);
  assert.equal(sms.sent.length, 0);
  await app.close();
});

test('send-sms hook: an SMS provider failure is reported to Supabase as 502', async () => {
  const app = await makeApp({ sms: { send: async () => { throw new Error('AT down'); } } });
  const { payload, headers } = signed({ user: { phone: '254712345678' }, sms: { otp: '111111' } });
  const res = await app.inject({ method: 'POST', url: '/hooks/send-sms', payload, headers });
  assert.equal(res.statusCode, 502);
  await app.close();
});

test('GET /v1/me needs a valid token', async () => {
  const app = await makeApp();
  assert.equal((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode, 401);
  const bad = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer nope' } });
  assert.equal(bad.statusCode, 401);
  const ok = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer good-token' } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), {
    id: 'user-1', email: 'wanjiru@example.com', phone: null, name: 'Wanjiru', roles: ['traveller'], language: 'sw', lowData: true,
  });
  await app.close();
});

test('config refuses to start production without secrets', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /SUPABASE_SERVICE_ROLE_KEY: required in production/);
});
