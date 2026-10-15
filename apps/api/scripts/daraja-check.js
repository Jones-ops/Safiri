/**
 * Checks your Daraja settings in apps/api/.env.
 *
 *   npm run daraja:check --workspace @safiri/api                 OAuth only
 *   npm run daraja:check --workspace @safiri/api -- 0712345678   also send a KES 1 prompt to
 *                                                                 that phone and follow it with
 *                                                                 STK Query for up to 2 minutes
 * In the sandbox no real money moves.
 */
const { normalizeMsisdn } = require('@safiri/shared');
const { loadConfig } = require('../src/config');
const { createDaraja } = require('../src/integrations/daraja');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const config = loadConfig();
  const missing = ['DARAJA_CONSUMER_KEY', 'DARAJA_CONSUMER_SECRET', 'DARAJA_SHORTCODE', 'DARAJA_PASSKEY', 'DARAJA_CALLBACK_BASE_URL', 'DARAJA_CALLBACK_SECRET']
    .filter((k) => !config[k]);
  if (missing.length) throw new Error(`Set these in apps/api/.env first: ${missing.join(', ')}`);

  const callbackUrl = `${config.DARAJA_CALLBACK_BASE_URL.replace(/\/$/, '')}/hooks/mpesa/stk/${config.DARAJA_CALLBACK_SECRET}`;
  const daraja = createDaraja({
    env: config.DARAJA_ENV,
    consumerKey: config.DARAJA_CONSUMER_KEY,
    consumerSecret: config.DARAJA_CONSUMER_SECRET,
    shortcode: config.DARAJA_SHORTCODE,
    passkey: config.DARAJA_PASSKEY,
    callbackUrl,
  });
  console.log(`Daraja ${config.DARAJA_ENV}, shortcode ${config.DARAJA_SHORTCODE}`);
  console.log(`Callback URL: ${config.DARAJA_CALLBACK_BASE_URL.replace(/\/$/, '')}/hooks/mpesa/stk/<secret>`);

  const phone = process.argv[2];
  if (!phone) {
    // An STK query for a made-up request proves OAuth and the password work without a prompt.
    const r = await daraja.stkQuery('ws_CO_000000000000000000').catch((err) => ({ error: err.message }));
    console.log(r.error && /invalid|not found|does not exist/i.test(r.error) ? 'OAuth OK (Daraja answered the test query).' : `Daraja answered: ${JSON.stringify(r)}`);
    console.log('Add a phone number to send a KES 1 test prompt.');
    return;
  }

  const msisdn = normalizeMsisdn(phone);
  if (!msisdn) throw new Error(`Not a Kenyan mobile number: ${phone}`);
  const push = await daraja.stkPush({ msisdn, amountKes: 1, accountReference: 'SAF-TEST01', description: 'Safiri test' });
  console.log(`Prompt sent to ${msisdn}: ${push.customerMessage}`);
  console.log(`CheckoutRequestID ${push.checkoutRequestId}. Enter your PIN (or cancel) on the phone...`);

  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const r = await daraja.stkQuery(push.checkoutRequestId).catch((err) => ({ state: 'error', resultDesc: err.message }));
    console.log(`  ${new Date().toLocaleTimeString()}  ${r.state}${r.resultDesc ? ` (${r.resultDesc})` : ''}`);
    if (r.state !== 'pending') return;
  }
  console.log('Still pending after 2 minutes.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
