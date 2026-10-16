/**
 * Fast synchronous on-device storage (MMKV). Separate instances keep the auth session,
 * the offline query cache and app settings apart, so one can be cleared without the others.
 *
 * The stores that hold the sign-in session, hold tokens and saved itineraries are encrypted
 * with a key kept in the phone's secure hardware store (Android Keystore), so a copy of the
 * app's files is useless without the phone. The photo/query cache holds only public data.
 */
import { createMMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

const KEY_NAME = 'safiri.storage.key';

/** The device's storage key, created on first run. Synchronous so stores open at import time. */
function storageKey() {
  try {
    let key = SecureStore.getItem(KEY_NAME);
    if (!key) {
      // 16 random bytes as hex: MMKV accepts up to 16 characters as the key, so take 16.
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      key = Array.from(bytes, (b) => b.toString(36)).join('').slice(0, 16).padEnd(16, 'k');
      SecureStore.setItem(KEY_NAME, key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
    }
    return key;
  } catch {
    return null; // no secure store (some emulators): fall back to unencrypted, still app-private
  }
}

const encryptionKey = storageKey() || undefined;

export const settingsStore = createMMKV({ id: 'settings', encryptionKey });
export const authStore = createMMKV({ id: 'auth', encryptionKey });
export const tripStore = createMMKV({ id: 'trips-offline', encryptionKey });
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
