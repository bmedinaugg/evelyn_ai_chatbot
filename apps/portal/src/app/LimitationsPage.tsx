import { type Lang, t } from '@trainmore/i18n';

const ITEMS = ['readOnly', 'invoices', 'history', 'faq', 'notLoggedIn'] as const;

export function LimitationsPage(props: { lang: Lang }) {
  const { lang } = props;
  return (
    <section>
      <h1>{t(lang, 'portal.nav.limitations')}</h1>
      <p>{t(lang, 'portal.limitations.intro')}</p>
      <ul>
        {ITEMS.map((item) => (
          <li key={item}>{t(lang, `portal.limitations.${item}`)}</li>
        ))}
      </ul>
    </section>
  );
}
