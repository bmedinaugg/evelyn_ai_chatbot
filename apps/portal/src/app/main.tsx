import { isLang, type Lang } from '@trainmore/i18n';
import { render } from 'preact';
import { createPortalApi } from '../lib/api.ts';
import { App } from './App.tsx';
import './portal.css';

const LANG_KEY = 'tm-portal-lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Storage blocked: fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'nl';
}

function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Not remembered; the page still works.
  }
}

const root = document.getElementById('app');
if (root)
  render(<App api={createPortalApi()} initialLang={initialLang()} onLangChange={saveLang} />, root);
