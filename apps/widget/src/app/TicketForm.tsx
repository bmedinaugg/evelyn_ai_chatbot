import { type Lang, t } from '@trainmore/i18n';
import { useEffect, useState } from 'preact/hooks';
import { type Session, type TicketTopic, type WidgetApi, WidgetApiError } from '../lib/api.ts';
import { useTurnstile } from './turnstile.ts';

type Status = 'idle' | 'sending' | 'verification_failed' | 'invalid' | 'error';

/**
 * General ticket form (hand-off to support), prefilled from the chat. The email of a verified
 * login is prefilled and locked; it stays in memory only. No ticket number is shown (privacy).
 */
export function TicketForm(props: {
  lang: Lang;
  api: WidgetApi;
  siteKey: string;
  ensureSession: () => Promise<Session>;
  prefill: { subject: string; description: string };
  verifiedEmail: string | null;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { lang, api } = props;
  const turnstile = useTurnstile(props.siteKey);
  const [status, setStatus] = useState<Status>('idle');
  const [topics, setTopics] = useState<TicketTopic[] | 'failed' | null>(null);

  useEffect(() => {
    let active = true;
    api.getTicketTopics(lang).then(
      (loaded) => active && setTopics(loaded),
      () => active && setTopics('failed'),
    );
    return () => {
      active = false;
    };
  }, [api, lang]);

  async function submit(event: Event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    if (!field('topic') || !field('subject') || !field('description')) {
      setStatus('invalid');
      return;
    }
    if (!turnstile.token) {
      setStatus('verification_failed');
      return;
    }
    setStatus('sending');
    try {
      await api.submitTicket(await props.ensureSession(), {
        email: props.verifiedEmail ?? field('email'),
        ...(field('name') ? { name: field('name') } : {}),
        topic: field('topic'),
        subject: field('subject'),
        description: field('description'),
        lang,
        turnstileToken: turnstile.token,
        consent: true,
      });
      props.onSubmitted();
    } catch (error) {
      // Turnstile tokens are single use: always fetch a new one after a failed submit.
      turnstile.reset();
      const kind = error instanceof WidgetApiError ? error.kind : 'server';
      setStatus(
        kind === 'verification_failed'
          ? 'verification_failed'
          : kind === 'invalid'
            ? 'invalid'
            : 'error',
      );
    }
  }

  return (
    <form class="tm-lead" aria-labelledby="tm-ticket-title" onSubmit={submit}>
      <h2 id="tm-ticket-title">{t(lang, 'widget.ticket.title')}</h2>
      {topics === 'failed' ? (
        <p class="tm-notice" role="alert">
          {t(lang, 'widget.ticket.unavailable')}
        </p>
      ) : (
        <>
          {/* Explicit labels: a wrapping label would add the options to the field's name. */}
          <label for="tm-ticket-topic">{t(lang, 'widget.ticket.topic')}</label>
          <select id="tm-ticket-topic" name="topic" required disabled={topics === null}>
            <option value="">{t(lang, 'widget.ticket.chooseTopic')}</option>
            {(topics ?? []).map((topic) => (
              <option key={topic.value} value={topic.value}>
                {topic.label}
              </option>
            ))}
          </select>
        </>
      )}
      <label>
        {t(lang, 'widget.ticket.email')}
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autocomplete="email"
          readOnly={props.verifiedEmail !== null}
          value={props.verifiedEmail ?? undefined}
        />
      </label>
      <label>
        {t(lang, 'widget.ticket.name')}
        <input name="name" type="text" maxLength={100} autocomplete="name" />
      </label>
      <label>
        {t(lang, 'widget.ticket.subject')}
        <input
          name="subject"
          type="text"
          required
          maxLength={150}
          defaultValue={props.prefill.subject}
        />
      </label>
      <label for="tm-ticket-description">{t(lang, 'widget.ticket.description')}</label>
      <textarea
        id="tm-ticket-description"
        name="description"
        required
        maxLength={5000}
        rows={4}
        defaultValue={props.prefill.description}
      />
      <label class="tm-check">
        <input name="consent" type="checkbox" required />
        {t(lang, 'widget.ticket.consent')}
      </label>
      <div ref={turnstile.container} class="tm-turnstile" />
      {turnstile.failed && (
        <p class="tm-notice" role="alert">
          {t(lang, 'widget.lead.unavailable')}
        </p>
      )}
      {status === 'invalid' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'widget.ticket.invalid')}
        </p>
      )}
      {status === 'verification_failed' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'widget.ticket.verificationFailed')}
        </p>
      )}
      {status === 'error' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'widget.ticket.error')}
        </p>
      )}
      <div class="tm-row">
        <button type="button" class="tm-button" onClick={props.onCancel}>
          {t(lang, 'widget.ticket.cancel')}
        </button>
        <button
          type="submit"
          class="tm-button tm-button--primary"
          disabled={status === 'sending' || !Array.isArray(topics)}
        >
          {t(lang, status === 'sending' ? 'widget.ticket.sending' : 'widget.ticket.submit')}
        </button>
      </div>
    </form>
  );
}
