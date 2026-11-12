import { type Lang, t } from '@trainmore/i18n';
import { safeHttpsUrl } from '../lib/urls.ts';

export function ConsentNotice(props: { lang: Lang; privacyUrl: string; onAccept: () => void }) {
  const privacy = safeHttpsUrl(props.privacyUrl);
  return (
    <section class="tm-consent">
      <p>{t(props.lang, 'widget.consent.text')}</p>
      {privacy && (
        <p>
          <a href={privacy} target="_blank" rel="noopener noreferrer">
            {t(props.lang, 'widget.consent.privacy')}
          </a>
        </p>
      )}
      <button type="button" class="tm-button tm-button--primary" onClick={props.onAccept}>
        {t(props.lang, 'widget.consent.accept')}
      </button>
    </section>
  );
}
