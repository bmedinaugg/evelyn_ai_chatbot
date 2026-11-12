import { type Lang, t } from '@trainmore/i18n';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type Me, type PortalApi, PortalApiError } from '../lib/api.ts';
import { CapabilitiesPage } from './CapabilitiesPage.tsx';
import { ConversationPage } from './ConversationPage.tsx';
import { FlaggedPage } from './FlaggedPage.tsx';
import { LimitationsPage } from './LimitationsPage.tsx';
import { MetricsPage } from './MetricsPage.tsx';
import { ScenarioEditor } from './ScenarioEditor.tsx';
import { ScenarioPage } from './ScenarioPage.tsx';
import { ScenariosPage } from './ScenariosPage.tsx';

type Auth = 'loading' | 'signed_out' | 'forbidden' | 'error' | Me;

type Route =
  | { page: 'flagged'; day: string | null }
  | { page: 'metrics' }
  | { page: 'conversation'; id: string }
  | { page: 'capabilities' }
  | { page: 'limitations' }
  | { page: 'scenarios' }
  | { page: 'new_scenario' }
  | { page: 'scenario'; id: string; saved: boolean };

/** Set by the API when a sign-in failed (`/portal/?signin_error=…`). */
function readSignInError(): 'invalid' | 'no_role' | null {
  const value = new URLSearchParams(location.search).get('signin_error');
  if (value !== 'invalid' && value !== 'no_role') return null;
  // Shown once: drop it from the address bar.
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  return value;
}

function parseRoute(hash: string): Route {
  const conversation = /^#\/conversations\/([0-9a-f-]{36})$/i.exec(hash);
  if (conversation?.[1]) return { page: 'conversation', id: conversation[1] };
  const scenario = /^#\/scenarios\/([0-9a-f-]{36})(\/saved)?$/i.exec(hash);
  if (scenario?.[1]) return { page: 'scenario', id: scenario[1], saved: scenario[2] !== undefined };
  if (hash === '#/scenarios/new') return { page: 'new_scenario' };
  if (hash === '#/scenarios') return { page: 'scenarios' };
  if (hash === '#/capabilities') return { page: 'capabilities' };
  if (hash === '#/limitations') return { page: 'limitations' };
  if (hash === '#/metrics') return { page: 'metrics' };
  // From the daily report: conversations flagged on one Amsterdam day.
  const day = /^#\/flagged\?day=(\d{4}-\d{2}-\d{2})$/.exec(hash);
  return { page: 'flagged', day: day?.[1] ?? null };
}

export function App(props: {
  api: PortalApi;
  initialLang: Lang;
  onLangChange: (lang: Lang) => void;
}) {
  const { api } = props;
  const [lang, setLang] = useState<Lang>(props.initialLang);
  const [auth, setAuth] = useState<Auth>('loading');
  const [route, setRoute] = useState<Route>(parseRoute(location.hash));
  const [signInError] = useState(readSignInError);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t(lang, 'portal.title');
  }, [lang]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api.me().then(setAuth, (error: unknown) => {
      const kind = error instanceof PortalApiError ? error.kind : 'server';
      setAuth(
        kind === 'unauthorized' ? 'signed_out' : kind === 'forbidden' ? 'forbidden' : 'error',
      );
    });
  }, [api]);

  function switchLang() {
    const next: Lang = lang === 'nl' ? 'en' : 'nl';
    setLang(next);
    props.onLangChange(next);
  }

  async function signOut() {
    try {
      await api.logout();
    } finally {
      setAuth('signed_out');
    }
  }

  const header = (
    <header class="tm-header">
      <span class="tm-brand">{t(lang, 'portal.title')}</span>
      {typeof auth === 'object' && (
        <nav aria-label={t(lang, 'portal.title')}>
          <a href="#/flagged" aria-current={route.page === 'flagged' ? 'page' : undefined}>
            {t(lang, 'portal.nav.flagged')}
          </a>
          <a href="#/metrics" aria-current={route.page === 'metrics' ? 'page' : undefined}>
            {t(lang, 'portal.nav.metrics')}
          </a>
          <a href="#/scenarios" aria-current={route.page.includes('scenario') ? 'page' : undefined}>
            {t(lang, 'portal.nav.scenarios')}
          </a>
          <a
            href="#/capabilities"
            aria-current={route.page === 'capabilities' ? 'page' : undefined}
          >
            {t(lang, 'portal.nav.capabilities')}
          </a>
          <a href="#/limitations" aria-current={route.page === 'limitations' ? 'page' : undefined}>
            {t(lang, 'portal.nav.limitations')}
          </a>
        </nav>
      )}
      <div class="tm-header__tools">
        <button type="button" class="tm-link" onClick={switchLang}>
          {t(lang, 'portal.language')}
        </button>
        {typeof auth === 'object' && (
          <>
            <span class="tm-user">{auth.name}</span>
            <button type="button" class="tm-button" onClick={signOut}>
              {t(lang, 'portal.signOut')}
            </button>
          </>
        )}
      </div>
    </header>
  );

  let content: JSX.Element;
  if (auth === 'loading') content = <p role="status">{t(lang, 'portal.loading')}</p>;
  else if (auth === 'signed_out')
    content = (
      <section class="tm-signin">
        <h1>{t(lang, 'portal.title')}</h1>
        <p>{t(lang, 'portal.signInIntro')}</p>
        {signInError && (
          <p class="tm-notice" role="alert">
            {t(lang, signInError === 'no_role' ? 'portal.signInNoRole' : 'portal.signInInvalid')}
          </p>
        )}
        {/* A real navigation: the server redirects to Microsoft. */}
        <a class="tm-button tm-button--primary" href="/portal/auth/login">
          {t(lang, 'portal.signIn')}
        </a>
      </section>
    );
  else if (auth === 'forbidden') content = <p role="alert">{t(lang, 'portal.forbidden')}</p>;
  else if (auth === 'error') content = <p role="alert">{t(lang, 'portal.error')}</p>;
  else if (route.page === 'conversation')
    content = <ConversationPage api={api} lang={lang} id={route.id} />;
  else if (route.page === 'capabilities')
    content = <CapabilitiesPage api={api} lang={lang} isAdmin={auth.roles.includes('admin')} />;
  else if (route.page === 'limitations') content = <LimitationsPage lang={lang} />;
  else if (route.page === 'scenarios') content = <ScenariosPage api={api} lang={lang} />;
  else if (route.page === 'new_scenario')
    content = (
      <ScenarioEditor
        api={api}
        lang={lang}
        onSaved={(id) => {
          location.hash = `#/scenarios/${id}/saved`;
        }}
      />
    );
  else if (route.page === 'scenario')
    content = (
      <ScenarioPage
        api={api}
        lang={lang}
        id={route.id}
        justSaved={route.saved}
        isApprover={auth.roles.some((r) => r === 'approver' || r === 'admin')}
      />
    );
  else if (route.page === 'metrics') content = <MetricsPage api={api} lang={lang} />;
  else content = <FlaggedPage api={api} lang={lang} day={route.day} />;

  return (
    <>
      {header}
      <main class="tm-main">{content}</main>
    </>
  );
}
