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
            <ContactLink
              lang={props.lang}
              show={message.action === 'contact'}
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
          </div>
        ),
      )}
      {props.sending && <p class="tm-typing">{t(props.lang, 'widget.typing')}</p>}
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
