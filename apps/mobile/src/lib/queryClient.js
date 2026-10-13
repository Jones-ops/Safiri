/**
 * TanStack Query with a cache saved to the phone, so screens open with the last data
 * they had even with no signal ("works on a bad day").
 */
import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { asStorage, cacheStore } from './storage';

const DAY = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst', // show cached data first, fetch when online
      staleTime: 5 * 60 * 1000,
      gcTime: 7 * DAY, // must be at least maxAge below, or persisted data is dropped
      retry: 2,
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

export const persistOptions = {
  persister: createSyncStoragePersister({ storage: asStorage(cacheStore), key: 'safiri-query-cache', throttleTime: 1000 }),
  maxAge: 7 * DAY,
  buster: '0.1.0', // bump when cached data shapes change
  // Live prices and holds are never saved for offline: a stale quote must not reappear.
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && !['quote', 'hold'].includes(query.queryKey[0]),
  },
};
