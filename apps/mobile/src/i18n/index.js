/**
 * English and Kiswahili from day one. Strings live in packages/shared so the API and the
 * public web pages use the same words.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { i18n as strings } from '@safiri/shared';
import { useSettings } from '../state/settings';

export function deviceLanguage() {
  return getLocales().some((l) => l.languageCode === 'sw') ? 'sw' : 'en';
}

export function currentLanguage() {
  return useSettings.getState().language || deviceLanguage();
}

i18n.use(initReactI18next).init({
  resources: strings.resources,
  lng: currentLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

// Follow the in-app language setting.
useSettings.subscribe((state, prev) => {
  if (state.language !== prev.language) i18n.changeLanguage(state.language || deviceLanguage());
});

export default i18n;
