const test = require('node:test');
const assert = require('node:assert/strict');
const { createDaraja, parseStkCallback, darajaTimestamp } = require('../src/integrations/daraja');

/** A fake Daraja that records requests and answers from a script. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const path = new URL(url).pathname;
    const answer = responses[path];
    const { status = 200, body } = typeof answer === 'function' ? answer() : answer;
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  return { calls, impl };
}

const base = {
  env: 'sandbox',
  consumerKey: 'key',
  consumerSecret: 'secret',
  shortcode: '174379',
  passkey: 'passkey',
  callbackUrl: 'https://api.example/hooks/mpesa/stk/s3cret',
  now: () => new Date('2026-10-13T09:05:07Z'),
};

const oauth = { body: { access_token: 'tok', expires_in: '3599' } };

test('timestamps are in Kenya time', () => {
  assert.equal(darajaTimestamp(new Date('2026-10-13T22:05:07Z')), '20261014010507');
});

test('STK push sends the documented request and caches the token', async () => {
  const f = fakeFetch({
    '/oauth/v1/generate': oauth,
    '/mpesa/stkpush/v1/processrequest': {
      body: { MerchantRequestID: 'mr-1', CheckoutRequestID: 'ws_CO_1', ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing' },
    },
  });
  const daraja = createDaraja({ ...base, fetchImpl: f.impl });
  const r = await daraja.stkPush({ msisdn: '254712345678', amountKes: 3925, accountReference: 'SAF-ABC234', description: 'Safiri deposit payment' });
  assert.deepEqual(r, { merchantRequestId: 'mr-1', checkoutRequestId: 'ws_CO_1', customerMessage: 'Success. Request accepted for processing' });

  const [auth, push] = f.calls;
  assert.equal(auth.init.method, 'GET');
  assert.equal(auth.init.headers.Authorization, `Basic ${Buffer.from('key:secret').toString('base64')}`);
  assert.equal(push.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(push.body, {
    BusinessShortCode: '174379',
    Password: Buffer.from('174379passkey20261013120507').toString('base64'),
    Timestamp: '20261013120507',
    TransactionType: 'CustomerPayBillOnline',
    Amount: 3925,
    PartyA: '254712345678',
    PartyB: '174379',
    PhoneNumber: '254712345678',
    CallBackURL: 'https://api.example/hooks/mpesa/stk/s3cret',
    AccountReference: 'SAF-ABC234',
    TransactionDesc: 'Safiri deposi', // cut to Daraja's 13 characters
  });

  await daraja.stkPush({ msisdn: '254712345678', amountKes: 1, accountReference: 'x', description: 'x' });
  assert.equal(f.calls.filter((c) => c.url.includes('oauth')).length, 1, 'token reused');
});

test('STK query: success, user cancelled, still processing', async () => {
  let answer = { body: { ResponseCode: '0', ResultCode: '0', ResultDesc: 'The service request is processed successfully.' } };
  const f = fakeFetch({ '/oauth/v1/generate': oauth, '/mpesa/stkpushquery/v1/query': () => answer });
  const daraja = createDaraja({ ...base, fetchImpl: f.impl });
  assert.equal((await daraja.stkQuery('ws_CO_1')).state, 'succeeded');
  answer = { body: { ResponseCode: '0', ResultCode: '1032', ResultDesc: 'Request cancelled by user' } };
  assert.equal((await daraja.stkQuery('ws_CO_1')).state, 'cancelled');
  answer = { status: 500, body: { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' } };
  assert.equal((await daraja.stkQuery('ws_CO_1')).state, 'pending');
});

test('an STK push Daraja refuses is an error, not a silent success', async () => {
  const f = fakeFetch({
    '/oauth/v1/generate': oauth,
    '/mpesa/stkpush/v1/processrequest': { status: 400, body: { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PhoneNumber' } },
  });
  const daraja = createDaraja({ ...base, fetchImpl: f.impl });
  await assert.rejects(daraja.stkPush({ msisdn: '25471', amountKes: 1, accountReference: 'x', description: 'x' }), /Invalid PhoneNumber/);
});

test('parses Daraja callbacks, success and failure', () => {
  const ok = parseStkCallback({
    Body: { stkCallback: {
      MerchantRequestID: 'mr-1', CheckoutRequestID: 'ws_CO_1', ResultCode: 0, ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: { Item: [{ Name: 'Amount', Value: 3925 }, { Name: 'MpesaReceiptNumber', Value: 'TJD4ABC123' }, { Name: 'TransactionDate', Value: 20261013120530 }, { Name: 'PhoneNumber', Value: 254712345678 }] },
    } },
  });
  assert.equal(ok.state, 'succeeded');
  assert.equal(ok.receipt, 'TJD4ABC123');
  assert.equal(ok.amountKes, 3925);
  const cancelled = parseStkCallback({ Body: { stkCallback: { MerchantRequestID: 'mr', CheckoutRequestID: 'ws', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.receipt, null);
  assert.equal(parseStkCallback({ hello: 'world' }), null);
});
