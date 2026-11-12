import type { Lang } from '@trainmore/i18n';

/** Freshdesk portal paths start with /nl/ or /en/; otherwise use <html lang>, then Dutch. */
export function detectPortalLang(pathname: string, htmlLang: string | null): Lang {
  const fromPath = /^\/(nl|en)(\/|$)/i.exec(pathname)?.[1]?.toLowerCase();
  if (fromPath === 'nl' || fromPath === 'en') return fromPath;
  const fromHtml = htmlLang?.slice(0, 2).toLowerCase();
  return fromHtml === 'en' ? 'en' : 'nl';
}
