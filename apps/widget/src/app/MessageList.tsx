import { type Lang, t } from '@trainmore/i18n';
import { useEffect, useRef } from 'preact/hooks';
import type { ChatMessage } from '../lib/chat-state.ts';
import { safeHttpsUrl } from '../lib/urls.ts';

/** Text is always rendered as text; links only from https URLs the API returned. */
export function MessageList(props: {
  lang: Lang;
  messages: ChatMessage[];
  sending: boolean;
  onOpenLeadForm: () => void;
  onOpenTicketForm: () => void;
  onOpenLogin: () => void;
  onRate: (id: number, rating: 'up' | 'down') => void;
}) {
  const log = useRef<HTMLDivElement>(null);
  // Keep the newest message (or the typing indicator) in view.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [props.messages.length, props.sending]);

  return (
    <div class="tm-messages" role="log" aria-live="polite" ref={log}>
      {props.messages.map((message) =>
        message.role === 'user' ? (
          <p key={message.id} class="tm-bubble tm-bubble--user">
            {message.text}
          </p>
        ) : message.role === 'note' ? (
          <p key={message.id} class="tm-note" role="status">
            {message.text}
          </p>
        ) : (
          <div key={message.id} class="tm-bubble tm-bubble--bot">
            <p>{message.text}</p>
            {message.citations.length > 0 && (
              <div class="tm-sources">
                <p class="tm-sources__label">{t(props.lang, 'widget.sources')}</p>
                <ul>
                  {message.citations.map((citation) => {
                    const href = safeHttpsUrl(citation.url);
                    return (
                      <li key={citation.articleId}>
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer">
                            {citation.title}
                          </a>
                        ) : (
                          citation.title
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {message.messageId !== undefined && (
              <Feedback
                lang={props.lang}
                rating={message.rating}
                onRate={(rating) => props.onRate(message.id, rating)}
              />
            )}
            {message.action === 'ticket_form' && (
              <button
                type="button"
                class="tm-button tm-button--primary"
                onClick={props.onOpenTicketForm}
              >
                {t(props.lang, 'widget.ticket.title')}
              </button>
            )}
            <ContactLink
              lang={props.lang}
              show={message.action === 'ticket_form'}
              url={message.contactUrl}
            />
            {message.action === 'lead_form' && (
              <button
                type="button"
                class="tm-button tm-button--primary"
                onClick={props.onOpenLeadForm}
              >
                {t(props.lang, 'widget.lead.title')}
              </button>
            )}
            {message.action === 'login' && (
              <button
                type="button"
                class="tm-button tm-button--primary"
                onClick={props.onOpenLogin}
              >
                {t(props.lang, 'widget.login.title')}
              </button>
            )}
          </div>
        ),
      )}
      {props.sending && <p class="tm-typing">{t(props.lang, 'widget.typing')}</p>}
    </div>
  );
}

function Thumb(props: { down?: boolean }) {
  // Inline icon (no icon font): a thumb, mirrored for "not helpful".
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      style={props.down ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path
        fill="currentColor"
        d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6c-.4.4-.6.9-.6 1.4v10a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-2z"
      />
    </svg>
  );
}

/** Thumbs up/down under a bot reply; the choice can be changed. */
function Feedback(props: {
  lang: Lang;
  rating: 'up' | 'down' | undefined;
  onRate: (rating: 'up' | 'down') => void;
}) {
  return (
    <div class="tm-feedback">
      <button
        type="button"
        class="tm-thumb"
        aria-label={t(props.lang, 'widget.feedback.helpful')}
        aria-pressed={props.rating === 'up'}
        onClick={() => props.onRate('up')}
      >
        <Thumb />
      </button>
      <button
        type="button"
        class="tm-thumb"
        aria-label={t(props.lang, 'widget.feedback.notHelpful')}
        aria-pressed={props.rating === 'down'}
        onClick={() => props.onRate('down')}
      >
        <Thumb down />
      </button>
      {props.rating && (
        <span class="tm-feedback__thanks" role="status">
          {t(props.lang, 'widget.feedback.thanks')}
        </span>
      )}
    </div>
  );
}

function ContactLink(props: { lang: Lang; show: boolean; url: string | undefined }) {
  const href = props.show ? safeHttpsUrl(props.url) : null;
  if (!href) return null;
  return (
    <a class="tm-cta" href={href} target="_blank" rel="noopener noreferrer">
      {t(props.lang, 'widget.contact')}
    </a>
  );
}
