/**
 * Fast synchronous on-device storage (MMKV). Separate instances keep the auth session,
 * the offline query cache and app settings apart, so one can be cleared without the others.
 */
import { createMMKV } from 'react-native-mmkv';

export const settingsStore = createMMKV({ id: 'settings' });
export const authStore = createMMKV({ id: 'auth' });
export const cacheStore = createMMKV({ id: 'query-cache' });

/** Adapter in the getItem/setItem/removeItem shape that Supabase, Zustand and TanStack expect. */
export function asStorage(mmkv) {
  return {
    getItem: (key) => mmkv.getString(key) ?? null,
    setItem: (key, value) => mmkv.set(key, value),
    removeItem: (key) => {
      mmkv.remove(key);
    },
  };
}
