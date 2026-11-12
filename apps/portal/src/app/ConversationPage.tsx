import { type Lang, t } from '@trainmore/i18n';
import { useEffect, useState } from 'preact/hooks';
import {
  type Conversation,
  FLAG_REASONS,
  type FlagReason,
  type PortalApi,
  PortalApiError,
} from '../lib/api.ts';
import { formatDate } from './FlaggedPage.tsx';

const isFlagReason = (value: string): value is FlagReason =>
  (FLAG_REASONS as readonly string[]).includes(value);

/** Only absolute https links (help articles) are rendered as links. */
const safeHttps = (url: string) => (/^https:\/\//.test(url) ? url : null);

export function ConversationPage(props: { api: PortalApi; lang: Lang; id: string }) {
  const { api, lang, id } = props;
  const [data, setData] = useState<Conversation | 'loading' | 'not_found' | 'error'>('loading');
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setData('loading');
    setRevealed(false);
    api
      .conversation(id)
      .then(setData, (error: unknown) =>
        setData(
          error instanceof PortalApiError && error.kind === 'not_found' ? 'not_found' : 'error',
        ),
      );
  }, [api, id]);

  async function reveal() {
    try {
      setData(await api.reveal(id));
      setRevealed(true);
    } catch {
      setData('error');
    }
  }

  return (
    <section>
      <p>
        <a href="#/flagged">{t(lang, 'portal.conversation.back')}</a>
      </p>
      {data === 'loading' && <p role="status">{t(lang, 'portal.loading')}</p>}
      {data === 'not_found' && <p role="alert">{t(lang, 'portal.conversation.notFound')}</p>}
      {data === 'error' && <p role="alert">{t(lang, 'portal.error')}</p>}
      {typeof data === 'object' && (
        <>
          <h1>{formatDate(lang, data.createdAt)}</h1>
          <ul class="tm-tags">
            {data.flags.map((f) => (
              <li key={`${f.reason}-${f.createdAt}`}>{t(lang, `portal.reasons.${f.reason}`)}</li>
            ))}
            {data.escalations.map((e) => (
              <li key={e.createdAt}>{t(lang, 'portal.conversation.ticket', { topic: e.topic })}</li>
            ))}
          </ul>
          {revealed ? (
            <p class="tm-notice" role="status">
              {t(lang, 'portal.conversation.revealed')}
            </p>
          ) : (
            <div class="tm-notice">
              <p>{t(lang, 'portal.conversation.masked')}</p>
              <p>{t(lang, 'portal.conversation.revealNote')}</p>
              <button type="button" class="tm-button" onClick={reveal}>
                {t(lang, 'portal.conversation.reveal')}
              </button>
            </div>
          )}
          <ol class="tm-transcript">
            {data.messages.map((m) => (
              <li key={m.id} class={`tm-message tm-message--${m.role}`}>
                <p class="tm-message__who">
                  {t(
                    lang,
                    m.role === 'user' ? 'portal.conversation.customer' : 'portal.conversation.bot',
                  )}
                  {' · '}
                  {formatDate(lang, m.createdAt)}
                  {m.outcome && m.outcome !== 'answered'
                    ? ` · ${isFlagReason(m.outcome) ? t(lang, `portal.reasons.${m.outcome}`) : m.outcome}`
                    : ''}
                </p>
                <p class="tm-message__text">{m.text}</p>
                {m.citations.length > 0 && (
                  <p class="tm-message__sources">
                    {t(lang, 'portal.conversation.sources')}:{' '}
                    {m.citations.map((c) => {
                      const href = safeHttps(c.url);
                      return href ? (
                        <a key={c.articleId} href={href} target="_blank" rel="noopener noreferrer">
                          {c.title}
                        </a>
                      ) : (
                        <span key={c.articleId}>{c.title}</span>
                      );
                    })}
                  </p>
                )}
                {m.rating && (
                  <p class="tm-message__rating">
                    {t(
                      lang,
                      m.rating === 'up'
                        ? 'portal.conversation.ratedUp'
                        : 'portal.conversation.ratedDown',
                    )}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
