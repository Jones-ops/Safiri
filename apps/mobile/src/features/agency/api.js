/** Agency and admin mode: packages, bookings, providers and payouts. All through the API. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function useManagedPackages() {
  return useQuery({ queryKey: ['manage', 'packages'], queryFn: async () => (await api('/v1/manage/packages')).packages });
}

export function useManagedPackage(id) {
  return useQuery({ queryKey: ['manage', 'package', id], enabled: Boolean(id) && id !== 'new', queryFn: () => api(`/v1/manage/packages/${id}`) });
}

export function useManagedDestinations() {
  return useQuery({ queryKey: ['manage', 'destinations'], staleTime: 10 * 60 * 1000, queryFn: async () => (await api('/v1/manage/destinations')).destinations });
}

export function useManagedListings(destinationId, agencyId) {
  const params = new URLSearchParams();
  if (destinationId) params.set('destinationId', destinationId);
  if (agencyId) params.set('agencyId', agencyId);
  return useQuery({
    queryKey: ['manage', 'listings', destinationId, agencyId],
    enabled: Boolean(destinationId),
    queryFn: async () => (await api(`/v1/manage/listings?${params}`)).listings,
  });
}

export function useSavePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) => api(id === 'new' ? '/v1/manage/packages' : `/v1/manage/packages/${id}`, { method: id === 'new' ? 'POST' : 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manage'] }),
  });
}

export function useSetPackageStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, publish }) => api(`/v1/manage/packages/${id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manage'] }),
  });
}

export function useManagedBookings() {
  return useQuery({ queryKey: ['manage', 'bookings'], queryFn: async () => (await api('/v1/manage/bookings')).bookings });
}

export function useAgencyProviders() {
  return useQuery({ queryKey: ['manage', 'providers'], queryFn: async () => (await api('/v1/manage/agency-providers')).providers });
}

export function useVerifyProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, verified }) => api(`/v1/manage/providers/${providerId}/verify`, { method: 'POST', body: { verified } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manage', 'providers'] }),
  });
}

export function useAgencyPayouts() {
  return useQuery({ queryKey: ['manage', 'payouts'], queryFn: () => api('/v1/manage/payouts') });
}
