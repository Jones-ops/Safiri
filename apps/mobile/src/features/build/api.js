/**
 * Quotes and holds, through the API. The app NEVER computes a price: everything shown in
 * the builder is the server quote. Quotes last 15 minutes; when one expires the query
 * refetches and the price bar shows the fresh number.
 */
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { settingsStore } from '../../lib/storage';

const HOLDS_KEY = 'hold-tokens';

/** Guest hold tokens, kept on the phone so the traveller can see or release their hold. */
export const holdTokens = {
  get(bookingId) {
    try {
      return JSON.parse(settingsStore.getString(HOLDS_KEY) || '{}')[bookingId] || null;
    } catch {
      return null;
    }
  },
  set(bookingId, token) {
    let all;
    try {
      all = JSON.parse(settingsStore.getString(HOLDS_KEY) || '{}');
    } catch {
      all = {};
    }
    all[bookingId] = token;
    settingsStore.set(HOLDS_KEY, JSON.stringify(all));
  },
};

/** request: { packageSlug } or { destinationSlug, nights, items }, plus startDate and travellers. */
export function useQuote(request, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['quote', request],
    enabled: enabled && Boolean(request),
    queryFn: () => api('/v1/quotes', { method: 'POST', body: request }),
    placeholderData: keepPreviousData, // keep showing the last price while the new one loads
    staleTime: 14 * 60 * 1000,
    // Refresh just after the server's 15 minutes run out.
    refetchInterval: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      return expiresAt ? Math.max(5000, new Date(expiresAt).getTime() - Date.now() + 1000) : false;
    },
    retry: (count, err) => !err.status && count < 2, // retry network blips, not "sold out"
  });
}

export function usePlaceHold() {
  return useMutation({
    mutationFn: ({ quoteId, phone }) => api('/v1/holds', { method: 'POST', body: { quoteId, phone } }),
    onSuccess: (hold) => holdTokens.set(hold.bookingId, hold.holdToken),
  });
}

const tokenQuery = (bookingId) => {
  const token = holdTokens.get(bookingId);
  return token ? `?token=${encodeURIComponent(token)}` : '';
};

export function useHold(bookingId) {
  return useQuery({
    queryKey: ['hold', bookingId],
    enabled: Boolean(bookingId),
    queryFn: () => api(`/v1/holds/${bookingId}${tokenQuery(bookingId)}`),
    refetchInterval: 30000, // status can change on the server (expiry; payment from Slice 3a)
  });
}

export function useReleaseHold() {
  return useMutation({
    mutationFn: (bookingId) => api(`/v1/holds/${bookingId}${tokenQuery(bookingId)}`, { method: 'DELETE' }),
  });
}
