/**
 * Group split through the API. The organiser's status updates live: Supabase Realtime pushes
 * changes when signed in (RLS lets the organiser see their group), and the query also polls
 * every 3 seconds, so a friend's payment shows within 5 seconds either way.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { holdTokens } from '../build/api';
import { useSession } from '../auth/session';

const tokenParam = (id) => {
  const token = holdTokens.get(id);
  return token ? `?token=${encodeURIComponent(token)}` : '';
};

export function useGroup(bookingId, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const key = ['hold', bookingId, 'group'];

  useEffect(() => {
    if (!enabled || !session || !supabase || !bookingId) return undefined;
    const channel = supabase
      .channel(`group-${bookingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `booking_id=eq.${bookingId}` },
        () => queryClient.invalidateQueries({ queryKey: key }))
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, session, bookingId, queryClient]);

  return useQuery({
    queryKey: key,
    enabled: enabled && Boolean(bookingId),
    queryFn: () => api(`/v1/bookings/${bookingId}/group${tokenParam(bookingId)}`),
    refetchInterval: (q) => (['fully_paid', 'cancelled', 'expired'].includes(q.state.data?.status) ? false : 3000),
    retry: (count, err) => err.status !== 404 && count < 2, // 404: not split yet
  });
}

export function useCreateSplit(bookingId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api(`/v1/bookings/${bookingId}/split`, { method: 'POST', body: { ...body, token: holdTokens.get(bookingId) || undefined } }),
    onSuccess: (group) => queryClient.setQueryData(['hold', bookingId, 'group'], group),
  });
}

export function useCoverShare(bookingId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId) => api(`/v1/bookings/${bookingId}/group/${memberId}/cover`, { method: 'POST', body: { token: holdTokens.get(bookingId) || undefined } }),
    onSuccess: (r) => queryClient.setQueryData(['hold', bookingId, 'group'], r.group),
  });
}
