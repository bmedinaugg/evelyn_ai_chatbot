import { type Lang, t } from '@trainmore/i18n';
import { detectPortalLang } from './lib/lang.ts';
import { buildIframeUrl, isWidgetMessage, parseWidgetUrl } from './loader-helpers.ts';

/**
 * Embedded on the help portal with:
 *   <script src="https://<widget host>/loader.js" data-widget-url="https://<widget host>/" async></script>
 * Adds a launcher button and the chat iframe. Styles come from loader.css on the widget host.
 */
function mountLoader(doc: Document, widgetUrl: URL, lang: Lang): void {
  const stylesheet = doc.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('loader.css', widgetUrl).toString();
  doc.head.append(stylesheet);

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'tm-chat-launcher';
  button.setAttribute('aria-label', t(lang, 'widget.open'));
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '?';

  const frame = doc.createElement('iframe');
  frame.className = 'tm-chat-frame';
  frame.title = t(lang, 'widget.title');
  frame.src = buildIframeUrl(widgetUrl, lang);
  frame.hidden = true;

  const setOpen = (open: boolean) => {
    frame.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', t(lang, open ? 'widget.close' : 'widget.open'));
    if (open) frame.focus();
    else button.focus();
  };

  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
  doc.defaultView?.addEventListener('message', (event) => {
    if (isWidgetMessage(event, widgetUrl.origin)) setOpen(false);
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') setOpen(false);
  });

  doc.body.append(frame, button);
}

// currentScript is only available while the script first runs; read it before waiting.
const script = document.currentScript as HTMLScriptElement | null;
const widgetUrl = parseWidgetUrl(script?.dataset.widgetUrl);
if (widgetUrl) {
  const mount = () =>
    mountLoader(
      document,
      widgetUrl,
      detectPortalLang(location.pathname, document.documentElement.lang || null),
    );
  // The script may run from <head> (or early, when async and cached) before <body> exists.
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
}
