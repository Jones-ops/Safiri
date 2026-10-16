/**
 * The signed-in person's account: which modes they can use, their referral code, cancelling a
 * trip, reviewing one, and their data rights (export, delete). All through the API.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { holdTokens } from '../build/api';
import { useSession } from '../auth/session';

/** Staff scope: admin flag and agencies. Travellers get 403, which here means "none". */
export function useStaff() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['staff', session?.user.id],
    enabled: Boolean(session),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        return await api('/v1/manage/me');
      } catch (err) {
        if (err.status === 403) return { admin: false, agencies: [], roles: ['traveller'] };
        throw err;
      }
    },
  });
}

/** The provider businesses this person owns (empty until they onboard). */
export function useMyProviders() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['my-providers', session?.user.id],
    enabled: Boolean(session),
    queryFn: async () => (await api('/v1/provider/me')).providers,
  });
}

export function useReferral() {
  const { session } = useSession();
  return useQuery({ queryKey: ['referral', session?.user.id], enabled: Boolean(session), queryFn: () => api('/v1/me/referral') });
}

const tokenQuery = (bookingId) => (holdTokens.get(bookingId) ? `?token=${encodeURIComponent(holdTokens.get(bookingId))}` : '');

export function useCancelPreview(bookingId) {
  return useQuery({ queryKey: ['cancel-preview', bookingId], enabled: Boolean(bookingId), queryFn: () => api(`/v1/bookings/${bookingId}/cancel${tokenQuery(bookingId)}`) });
}

export function useCancelTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId) => api(`/v1/bookings/${bookingId}/cancel`, { method: 'POST', body: { token: holdTokens.get(bookingId) || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['itinerary'] });
    },
  });
}

export function usePostReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, rating, body, mediaPaths }) => api('/v1/me/reviews', { method: 'POST', body: { bookingId, rating, body: body || undefined, mediaPaths: mediaPaths?.length ? mediaPaths : undefined } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  });
}

export const exportMyData = () => api('/v1/me/export', { timeoutMs: 60000 });
export const deleteMyAccount = () => api('/v1/me', { method: 'DELETE', timeoutMs: 60000 });
