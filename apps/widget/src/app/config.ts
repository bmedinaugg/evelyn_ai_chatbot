import { isLang, type Lang } from '@trainmore/i18n';

export type WidgetConfig = {
  apiBaseUrl: string;
  turnstileSiteKey: string;
  privacyUrl: string;
};

export const config: WidgetConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '',
  privacyUrl: import.meta.env.VITE_PRIVACY_URL ?? '',
};

export function langFromQuery(search: string): Lang {
  const lang = new URLSearchParams(search).get('lang');
  return isLang(lang) ? lang : 'nl';
}
