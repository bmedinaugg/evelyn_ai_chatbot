import { type Lang, t } from '@trainmore/i18n';
import { useState } from 'preact/hooks';
import { type WidgetApi, WidgetApiError } from '../lib/api.ts';
import { useTurnstile } from './turnstile.ts';

type Status = 'idle' | 'sending' | 'verification_failed' | 'error';

export function LeadForm(props: {
  lang: Lang;
  api: WidgetApi;
  siteKey: string;
  conversationId: string | undefined;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { lang } = props;
  const turnstile = useTurnstile(props.siteKey);
  const [status, setStatus] = useState<Status>('idle');

  async function submit(event: Event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    if (!turnstile.token) {
      setStatus('verification_failed');
      return;
    }
    const phone = String(form.get('phone') ?? '').trim();
    setStatus('sending');
    try {
      await props.api.submitLead({
        email: String(form.get('email') ?? ''),
        ...(phone ? { phone } : {}),
        question: String(form.get('question') ?? ''),
        lang,
        turnstileToken: turnstile.token,
        consent: true,
        ...(props.conversationId ? { conversationId: props.conversationId } : {}),
      });
      props.onSubmitted();
    } catch (error) {
      turnstile.reset();
      setStatus(
        error instanceof WidgetApiError && error.kind === 'verification_failed'
          ? 'verification_failed'
          : 'error',
      );
    }
  }

  return (
    <form class="tm-lead" aria-labelledby="tm-lead-title" onSubmit={submit}>
      <h2 id="tm-lead-title">{t(lang, 'widget.lead.title')}</h2>
      <label>
        {t(lang, 'widget.lead.email')}
        <input name="email" type="email" required maxLength={254} autocomplete="email" />
      </label>
      <label>
        {t(lang, 'widget.lead.phone')}
        <input name="phone" type="tel" maxLength={20} autocomplete="tel" />
      </label>
      <label>
        {t(lang, 'widget.lead.question')}
        <textarea name="question" required maxLength={2000} rows={3} />
      </label>
      <label class="tm-check">
        <input name="consent" type="checkbox" required />
        {t(lang, 'widget.lead.consent')}
      </label>
      <div ref={turnstile.container} class="tm-turnstile" />
      {status === 'verification_failed' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'widget.lead.verificationFailed')}
        </p>
      )}
      {status === 'error' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'widget.lead.error')}
        </p>
      )}
      <div class="tm-row">
        <button type="button" class="tm-button" onClick={props.onCancel}>
          {t(lang, 'widget.lead.cancel')}
        </button>
        <button type="submit" class="tm-button tm-button--primary" disabled={status === 'sending'}>
          {t(lang, status === 'sending' ? 'widget.lead.sending' : 'widget.lead.submit')}
        </button>
      </div>
    </form>
  );
}
