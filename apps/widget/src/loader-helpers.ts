import type { Lang } from '@trainmore/i18n';

export const CLOSE_MESSAGE = 'trainmore-widget:close';

/** The widget must be served over https (plain http only for local development). */
export function parseWidgetUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local =
      url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    return url.protocol === 'https:' || local ? url : null;
  } catch {
    return null;
  }
}

export function buildIframeUrl(widgetUrl: URL, lang: Lang): string {
  const url = new URL(widgetUrl);
  url.searchParams.set('lang', lang);
  return url.toString();
}

export function isWidgetMessage(
  event: { origin: string; data: unknown },
  widgetOrigin: string,
): boolean {
  return (
    event.origin === widgetOrigin &&
    typeof event.data === 'object' &&
    event.data !== null &&
    (event.data as { type?: unknown }).type === CLOSE_MESSAGE
  );
}
