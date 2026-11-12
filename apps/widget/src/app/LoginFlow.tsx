import { type Lang, t } from '@trainmore/i18n';
import { useState } from 'preact/hooks';
import {
  type AccountChoice,
  type LoginResult,
  type Session,
  type WidgetApi,
  WidgetApiError,
} from '../lib/api.ts';
import { useTurnstile } from './turnstile.ts';

type Step = 'email' | 'code' | 'choose' | 'lookup_failed';
type Problem = 'invalid_code' | 'locked' | 'expired' | 'verification' | 'error' | null;

const PROBLEM_KEYS = {
  invalid_code: 'widget.login.invalidCode',
  locked: 'widget.login.locked',
  expired: 'widget.login.expired',
  verification: 'widget.lead.verificationFailed',
  error: 'bot.error',
} as const;

/** Email → code → (account choice). The email stays in memory only; the server binds the account. */
export function LoginFlow(props: {
  lang: Lang;
  api: WidgetApi;
  siteKey: string;
  ensureSession: () => Promise<Session>;
  onLoggedIn: (account: AccountChoice | null) => void;
  onCancel: () => void;
}) {
  const { lang, api } = props;
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      const kind = error instanceof WidgetApiError ? error.kind : 'server';
      if (kind === 'lookup_failed') setStep('lookup_failed');
      else if (kind === 'invalid_code' || kind === 'locked' || kind === 'expired') setProblem(kind);
      else if (kind === 'verification_failed') setProblem('verification');
      else setProblem('error');
    } finally {
      setBusy(false);
    }
  }

  function handleResult(result: LoginResult) {
    if (result.selected !== null) return props.onLoggedIn(result.accounts[result.selected] ?? null);
    if (result.accounts.length === 0) return props.onLoggedIn(null);
    setAccounts(result.accounts);
    setStep('choose');
  }

  return (
    <form
      class="tm-lead"
      aria-labelledby="tm-login-title"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <h2 id="tm-login-title">{t(lang, 'widget.login.title')}</h2>
      {step === 'email' && (
        <EmailStep
          lang={lang}
          siteKey={props.siteKey}
          busy={busy}
          onSubmit={(value, token) =>
            run(async () => {
              const session = await props.ensureSession();
              await api.requestLoginCode(session, value, lang, token);
              setEmail(value);
              setStep('code');
            })
          }
        />
      )}
      {step === 'code' && (
        <CodeStep
          lang={lang}
          busy={busy}
          onSubmit={(code) =>
            run(async () =>
              handleResult(await api.verifyLoginCode(await props.ensureSession(), email, code)),
            )
          }
          onNewCode={() => setStep('email')}
        />
      )}
      {step === 'choose' && (
        <div class="tm-accounts">
          <p>{t(lang, 'widget.login.chooseAccount')}</p>
          {accounts.map((account) => (
            <button
              key={account.index}
              type="button"
              class="tm-button"
              disabled={busy}
              onClick={() =>
                run(async () =>
                  props.onLoggedIn(
                    await api.selectAccount(await props.ensureSession(), account.index),
                  ),
                )
              }
            >
              {`${account.studioName} · ${t(lang, `widget.status.${account.status}`)} · ${account.maskedNumber}`}
            </button>
          ))}
        </div>
      )}
      {step === 'lookup_failed' && (
        <>
          <p class="tm-notice" role="alert">
            {t(lang, 'widget.login.lookupFailed')}
          </p>
          <button
            type="button"
            class="tm-button tm-button--primary"
            disabled={busy}
            onClick={() =>
              run(async () =>
                handleResult(await api.lookupAccounts(await props.ensureSession(), email)),
              )
            }
          >
            {t(lang, 'widget.login.retry')}
          </button>
        </>
      )}
      {problem && (
        <p class="tm-notice" role="alert">
          {t(lang, PROBLEM_KEYS[problem])}
        </p>
      )}
      <div class="tm-row">
        <button type="button" class="tm-button" onClick={props.onCancel}>
          {t(lang, 'widget.login.cancel')}
        </button>
      </div>
    </form>
  );
}

function EmailStep(props: {
  lang: Lang;
  siteKey: string;
  busy: boolean;
  onSubmit: (email: string, token: string) => void;
}) {
  const turnstile = useTurnstile(props.siteKey);
  const [value, setValue] = useState('');
  return (
    <>
      <p>{t(props.lang, 'widget.login.intro')}</p>
      <label>
        {t(props.lang, 'widget.login.email')}
        <input
          type="email"
          required
          maxLength={254}
          autocomplete="email"
          value={value}
          onInput={(event) => setValue((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <div ref={turnstile.container} class="tm-turnstile" />
      {turnstile.failed && (
        <p class="tm-notice" role="alert">
          {t(props.lang, 'widget.lead.unavailable')}
        </p>
      )}
      <button
        type="button"
        class="tm-button tm-button--primary"
        disabled={props.busy || !turnstile.token || !/^\S+@\S+\.\S+$/.test(value.trim())}
        onClick={() => turnstile.token && props.onSubmit(value.trim(), turnstile.token)}
      >
        {t(props.lang, 'widget.login.sendCode')}
      </button>
    </>
  );
}

function CodeStep(props: {
  lang: Lang;
  busy: boolean;
  onSubmit: (code: string) => void;
  onNewCode: () => void;
}) {
  const [code, setCode] = useState('');
  return (
    <>
      <p>{t(props.lang, 'widget.login.codeSent')}</p>
      <label>
        {t(props.lang, 'widget.login.code')}
        <input
          type="text"
          inputMode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onInput={(event) =>
            setCode((event.currentTarget as HTMLInputElement).value.replace(/\D/g, ''))
          }
        />
      </label>
      <button
        type="button"
        class="tm-button tm-button--primary"
        disabled={props.busy || code.length !== 6}
        onClick={() => props.onSubmit(code)}
      >
        {t(props.lang, 'widget.login.verify')}
      </button>
      <button type="button" class="tm-link-button" onClick={props.onNewCode}>
        {t(props.lang, 'widget.login.newCode')}
      </button>
    </>
  );
}
