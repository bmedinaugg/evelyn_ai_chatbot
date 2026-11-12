import { type Lang, t } from '@trainmore/i18n';
import { useReducer, useRef, useState } from 'preact/hooks';
import { type Session, type WidgetApi, WidgetApiError } from '../lib/api.ts';
import { chatReducer, initialChatState, type Notice } from '../lib/chat-state.ts';
import { CLOSE_MESSAGE } from '../loader-helpers.ts';
import { ConsentNotice } from './ConsentNotice.tsx';
import { LeadForm } from './LeadForm.tsx';
import { MessageList } from './MessageList.tsx';
import { loadStored, saveStored } from './session.ts';

const MAX_LENGTH = 1000;

const NOTICE_KEYS = {
  busy: 'widget.errors.busy',
  rate_limited: 'widget.errors.rateLimited',
  network: 'widget.errors.network',
  error: 'bot.error',
} as const;

function noticeFor(error: unknown): Notice {
  if (!(error instanceof WidgetApiError)) return 'error';
  if (error.kind === 'busy' || error.kind === 'rate_limited' || error.kind === 'network')
    return error.kind;
  return 'error';
}

export function App(props: {
  lang: Lang;
  api: WidgetApi;
  privacyUrl: string;
  turnstileSiteKey: string;
}) {
  const { lang, api } = props;
  const stored = useRef(loadStored());
  const [state, dispatch] = useReducer(chatReducer, initialChatState(stored.current.consentGiven));
  const [draft, setDraft] = useState('');

  const remember = (session: Session | null) => {
    stored.current = { ...stored.current, session };
    saveStored(stored.current);
  };

  async function ensureSession(): Promise<Session> {
    if (stored.current.session) return stored.current.session;
    const session = await api.createConversation(lang);
    remember(session);
    return session;
  }

  async function send(event: Event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || text.length > MAX_LENGTH || state.phase !== 'ready') return;
    dispatch({ type: 'send_started', text });
    setDraft('');
    try {
      let session = await ensureSession();
      let reply: Awaited<ReturnType<WidgetApi['sendMessage']>>;
      try {
        reply = await api.sendMessage(session, text, lang);
      } catch (error) {
        // The conversation expired or is unknown: start a new one and resend once.
        if (!(error instanceof WidgetApiError && error.kind === 'not_found')) throw error;
        remember(null);
        session = await ensureSession();
        reply = await api.sendMessage(session, text, lang);
      }
      dispatch({ type: 'send_succeeded', reply });
    } catch (error) {
      dispatch({ type: 'send_failed', notice: noticeFor(error) });
    }
  }

  function acceptConsent() {
    stored.current = { ...stored.current, consentGiven: true };
    saveStored(stored.current);
    dispatch({ type: 'consent_given' });
  }

  function newChat() {
    remember(null);
    dispatch({ type: 'new_chat' });
  }

  return (
    <div class="tm-widget">
      <header class="tm-header">
        <div>
          <h1>{t(lang, 'widget.title')}</h1>
          <p>{t(lang, 'widget.subtitle')}</p>
        </div>
        <button
          type="button"
          class="tm-icon-button"
          aria-label={t(lang, 'widget.close')}
          onClick={() => window.parent.postMessage({ type: CLOSE_MESSAGE }, '*')}
        >
          ×
        </button>
      </header>

      {state.phase === 'consent' ? (
        <ConsentNotice lang={lang} privacyUrl={props.privacyUrl} onAccept={acceptConsent} />
      ) : (
        <>
          <MessageList
            lang={lang}
            messages={state.messages}
            sending={state.phase === 'sending'}
            onOpenLeadForm={() => dispatch({ type: 'lead_form_opened' })}
          />
          {state.notice && (
            <p class="tm-notice" role="status">
              {t(lang, NOTICE_KEYS[state.notice])}
            </p>
          )}
          {state.leadForm === 'open' && (
            <LeadForm
              lang={lang}
              api={api}
              siteKey={props.turnstileSiteKey}
              conversationId={stored.current.session?.conversationId}
              onSubmitted={() => dispatch({ type: 'lead_submitted' })}
              onCancel={() => dispatch({ type: 'lead_form_closed' })}
            />
          )}
          {state.leadForm === 'submitted' && (
            <p class="tm-success" role="status">
              {t(lang, 'widget.lead.success')}
            </p>
          )}
          <form class="tm-composer" onSubmit={send}>
            <textarea
              aria-label={t(lang, 'widget.input.placeholder')}
              placeholder={t(lang, 'widget.input.placeholder')}
              value={draft}
              maxLength={MAX_LENGTH}
              rows={2}
              disabled={state.phase === 'sending'}
              onInput={(event) => setDraft((event.currentTarget as HTMLTextAreaElement).value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) send(event);
              }}
            />
            <button
              type="submit"
              class="tm-button tm-button--primary"
              disabled={state.phase === 'sending' || !draft.trim()}
            >
              {t(lang, 'widget.input.send')}
            </button>
          </form>
          {state.messages.length > 0 && (
            <button type="button" class="tm-link-button" onClick={newChat}>
              {t(lang, 'widget.newChat')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
