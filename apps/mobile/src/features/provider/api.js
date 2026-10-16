/** Provider mode: requests to accept, the calendar, prices and payouts. All through the API. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function useProviderRequests() {
  return useQuery({ queryKey: ['provider', 'requests'], queryFn: async () => (await api('/v1/provider/requests')).requests, refetchInterval: 60 * 1000 });
}

export function useRespond() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, accept }) => api(`/v1/provider/requests/${code}/respond`, { method: 'POST', body: { accept } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider', 'requests'] }),
  });
}

export function useCalendar(listingId, month) {
  return useQuery({
    queryKey: ['provider', 'calendar', listingId, month],
    enabled: Boolean(listingId && month),
    queryFn: async () => (await api(`/v1/provider/listings/${listingId}/calendar?month=${month}`)).days,
  });
}

export function useBlockDates(listingId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dates, blocked }) => api(`/v1/provider/listings/${listingId}/block`, { method: 'POST', body: { dates, blocked } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider', 'calendar', listingId] }),
  });
}

export function useSeasons(listingId) {
  return useQuery({ queryKey: ['provider', 'prices', listingId], enabled: Boolean(listingId), queryFn: async () => (await api(`/v1/provider/listings/${listingId}/prices`)).seasons });
}

export function useSaveSeasons(listingId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seasons) => api(`/v1/provider/listings/${listingId}/prices`, { method: 'PUT', body: { seasons } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provider', 'prices', listingId] }),
  });
}

export function useProviderPayouts() {
  return useQuery({ queryKey: ['provider', 'payouts'], queryFn: () => api('/v1/provider/payouts') });
}

export function useOnboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => api('/v1/provider/onboard', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-providers'] }),
  });
}
