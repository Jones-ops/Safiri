/**
 * Safaricom Daraja: OAuth, STK Push (Lipa na M-PESA Online) and STK Query.
 * Sandbox first (DARAJA_ENV=sandbox). Only the API ever holds these credentials.
 *
 * STK Query ResultCode meanings used here:
 *   "0" success · "1032" cancelled by the user · "1037" no response from the phone (timeout)
 *   "1" insufficient funds · "2001" wrong PIN · anything else: failed
 * While the customer is still on the PIN screen, the query answers with an error
 * ("The transaction is being processed"): that means "still pending", not failure.
 */

const HOSTS = { sandbox: 'https://sandbox.safaricom.co.ke', production: 'https://api.safaricom.co.ke' };

class DarajaError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** YYYYMMDDHHmmss in Kenya time, as Daraja expects. */
function darajaTimestamp(now = new Date()) {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** Outcome of an STK Query or callback ResultCode. */
function classifyResult(code) {
  const c = String(code);
  if (c === '0') return 'succeeded';
  if (c === '1032') return 'cancelled';
  if (c === '1037') return 'timed_out';
  return 'failed';
}

function createDaraja({ env = 'sandbox', consumerKey, consumerSecret, shortcode, passkey, callbackUrl, fetchImpl = fetch, now = () => new Date() }) {
  const configured = Boolean(consumerKey && consumerSecret && shortcode && passkey && callbackUrl);
  const host = HOSTS[env] || HOSTS.sandbox;
  let token = null;

  async function request(path, { method = 'POST', body, auth } = {}) {
    const res = await fetchImpl(`${host}${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  }

  async function accessToken() {
    if (token && token.until > Date.now()) return token.value;
    const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const { ok, status, data } = await request('/oauth/v1/generate?grant_type=client_credentials', { method: 'GET', auth: `Basic ${basic}` });
    if (!ok || !data?.access_token) throw new DarajaError('Daraja OAuth failed', { status, body: data });
    // Refresh a minute early; tokens last an hour.
    token = { value: data.access_token, until: Date.now() + (Number(data.expires_in || 3599) - 60) * 1000 };
    return token.value;
  }

  function password(timestamp) {
    return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  }

  return {
    configured,
    env,

    /**
     * Sends the "enter your M-PESA PIN" prompt to the phone.
     * @returns {{ merchantRequestId, checkoutRequestId, customerMessage }}
     */
    async stkPush({ msisdn, amountKes, accountReference, description }) {
      if (!configured) throw new DarajaError('Daraja is not configured');
      const timestamp = darajaTimestamp(now());
      const { ok, status, data } = await request('/mpesa/stkpush/v1/processrequest', {
        auth: `Bearer ${await accessToken()}`,
        body: {
          BusinessShortCode: shortcode,
          Password: password(timestamp),
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: amountKes,
          PartyA: msisdn,
          PartyB: shortcode,
          PhoneNumber: msisdn,
          CallBackURL: callbackUrl,
          AccountReference: String(accountReference).slice(0, 12), // Daraja limit
          TransactionDesc: String(description).slice(0, 13), // Daraja limit
        },
      });
      if (!ok || data?.ResponseCode !== '0') {
        throw new DarajaError(data?.errorMessage || data?.ResponseDescription || 'STK push failed', { status, body: data });
      }
      return {
        merchantRequestId: data.MerchantRequestID,
        checkoutRequestId: data.CheckoutRequestID,
        customerMessage: data.CustomerMessage,
      };
    },

    /** @returns {{ state: 'pending'|'succeeded'|'cancelled'|'timed_out'|'failed', resultCode, resultDesc }} */
    async stkQuery(checkoutRequestId) {
      if (!configured) throw new DarajaError('Daraja is not configured');
      const timestamp = darajaTimestamp(now());
      const { status, data } = await request('/mpesa/stkpushquery/v1/query', {
        auth: `Bearer ${await accessToken()}`,
        body: { BusinessShortCode: shortcode, Password: password(timestamp), Timestamp: timestamp, CheckoutRequestID: checkoutRequestId },
      });
      if (data?.ResultCode !== undefined) {
        return { state: classifyResult(data.ResultCode), resultCode: Number(data.ResultCode), resultDesc: data.ResultDesc };
      }
      // "The transaction is being processed" (and Daraja's rate limits) mean: ask again later.
      if (/being processed/i.test(data?.errorMessage || '') || status === 429 || status >= 500) {
        return { state: 'pending', resultCode: null, resultDesc: data?.errorMessage || null };
      }
      throw new DarajaError(data?.errorMessage || 'STK query failed', { status, body: data });
    },
  };
}

/** Pulls the fields we use out of a Daraja STK callback body. Returns null if it isn't one. */
function parseStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string') return null;
  const items = Object.fromEntries((cb.CallbackMetadata?.Item || []).map((i) => [i.Name, i.Value]));
  return {
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: Number(cb.ResultCode),
    resultDesc: cb.ResultDesc,
    state: classifyResult(cb.ResultCode),
    amountKes: items.Amount == null ? null : Number(items.Amount),
    receipt: items.MpesaReceiptNumber ? String(items.MpesaReceiptNumber) : null,
    phone: items.PhoneNumber ? String(items.PhoneNumber) : null,
  };
}

module.exports = { createDaraja, parseStkCallback, classifyResult, darajaTimestamp, DarajaError };
