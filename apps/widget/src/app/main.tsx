import { render } from 'preact';
import { createWidgetApi } from '../lib/api.ts';
import { App } from './App.tsx';
import { config, langFromQuery } from './config.ts';
import './widget.css';

const lang = langFromQuery(location.search);
document.documentElement.lang = lang;
const root = document.getElementById('app');
if (root) {
  render(
    <App
      lang={lang}
      api={createWidgetApi({ baseUrl: config.apiBaseUrl })}
      privacyUrl={config.privacyUrl}
      turnstileSiteKey={config.turnstileSiteKey}
    />,
    root,
  );
}
