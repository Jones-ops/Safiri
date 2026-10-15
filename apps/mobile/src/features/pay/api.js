/**
 * Checkout and M-PESA through the API. The app sends the chosen option (deposit or full),
 * never an amount; the server decides what to charge and confirms with Safaricom.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { holdTokens } from '../build/api';

const withToken = (bookingId) => {
  const token = holdTokens.get(bookingId);
  return token ? `?token=${encodeURIComponent(token)}` : '';
};

/** Payment statuses that won't change any more. */
export const SETTLED = ['succeeded', 'failed', 'cancelled', 'timed_out'];

export function useBooking(bookingId, { refetchInterval } = {}) {
  return useQuery({
    queryKey: ['hold', bookingId, 'summary'], // under 'hold': never saved for offline
    enabled: Boolean(bookingId),
    queryFn: () => api(`/v1/bookings/${bookingId}${withToken(bookingId)}`),
    refetchInterval,
  });
}

export function useStartPayment() {
  return useMutation({
    mutationFn: ({ bookingId, option, phone }) =>
      api('/v1/payments', { method: 'POST', body: { bookingId, option, phone, token: holdTokens.get(bookingId) || undefined } }),
  });
}

/** Polls a payment every 3 seconds until it settles (the API falls back to STK Query when slow). */
export function usePayment(bookingId, paymentId) {
  return useQuery({
    queryKey: ['hold', bookingId, 'payment', paymentId],
    enabled: Boolean(paymentId),
    queryFn: () => api(`/v1/payments/${paymentId}${withToken(bookingId)}`),
    refetchInterval: (query) => (SETTLED.includes(query.state.data?.status) ? false : 3000),
  });
}

export function useClaimBooking() {
  return useMutation({
    mutationFn: (bookingId) => api(`/v1/bookings/${bookingId}/claim`, { method: 'POST', body: { token: holdTokens.get(bookingId) || undefined } }),
  });
}
