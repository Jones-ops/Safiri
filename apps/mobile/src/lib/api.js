/**
 * Calls to the Safiri API (money, inventory, messages). Sends the user's access token;
 * the API checks it before doing anything.
 */
import { supabase } from './supabase';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(message, { status, code, offline } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.offline = Boolean(offline);
  }
}

export async function api(path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  if (!BASE_URL) throw new ApiError('EXPO_PUBLIC_API_URL is not set', { code: 'not_configured' });

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError('Network request failed', { offline: true });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.message || `HTTP ${res.status}`, { status: res.status, code: data?.error });
  return data;
}
