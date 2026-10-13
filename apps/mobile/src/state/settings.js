/**
 * App settings kept on the phone: language, data saver, Welcome done, and consents.
 * Consents are given on the Welcome screen before sign-in, then copied to the
 * consents table once the user signs in (see features/auth/syncAfterSignIn).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CONSENT_PURPOSES } from '@safiri/shared';
import { asStorage, settingsStore } from '../lib/storage';

const noConsents = Object.fromEntries(Object.values(CONSENT_PURPOSES).map((p) => [p, false]));

export const useSettings = create(
  persist(
    (set) => ({
      language: null, // null = follow the phone's language
      lowData: false,
      welcomeDone: false,
      consents: noConsents,
      consentsChangedAt: null,

      setLanguage: (language) => set({ language }),
      setLowData: (lowData) => set({ lowData }),
      setConsent: (purpose, granted) =>
        set((s) => ({ consents: { ...s.consents, [purpose]: granted }, consentsChangedAt: new Date().toISOString() })),
      completeWelcome: () => set({ welcomeDone: true }),
    }),
    {
      name: 'safiri-settings',
      version: 1,
      storage: createJSONStorage(() => asStorage(settingsStore)),
    },
  ),
);
