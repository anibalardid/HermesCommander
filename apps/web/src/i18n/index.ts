import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/translation.json';
import es from './locales/es/translation.json';

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('hermes-commander.lang') : null;

export const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: stored ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
