import { type Lang, t } from '@trainmore/i18n';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type Me, type PortalApi, PortalApiError } from '../lib/api.ts';
import { CapabilitiesPage } from './CapabilitiesPage.tsx';
import { ConversationPage } from './ConversationPage.tsx';
import { FlaggedPage } from './FlaggedPage.tsx';
import { LimitationsPage } from './LimitationsPage.tsx';

type Auth = 'loading' | 'signed_out' | 'forbidden' | 'error' | Me;

type Route =
  | { page: 'flagged' }
  | { page: 'conversation'; id: string }
  | { page: 'capabilities' }
  | { page: 'limitations' };

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
  if (hash === '#/capabilities') return { page: 'capabilities' };
  if (hash === '#/limitations') return { page: 'limitations' };
  return { page: 'flagged' };
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
  else content = <FlaggedPage api={api} lang={lang} />;

  return (
    <>
      {header}
      <main class="tm-main">{content}</main>
    </>
  );
}
