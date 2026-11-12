import { type Lang, t } from '@trainmore/i18n';
import { useEffect, useState } from 'preact/hooks';
import {
  FLAG_REASONS,
  type FlagReason,
  type FlaggedPage as Page,
  type PortalApi,
} from '../lib/api.ts';

const DAY_OPTIONS = [1, 7, 30, 90] as const;

export const formatDate = (lang: Lang, iso: string) =>
  new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Amsterdam',
  }).format(new Date(iso));

export function FlaggedPage(props: { api: PortalApi; lang: Lang }) {
  const { api, lang } = props;
  const [reason, setReason] = useState<FlagReason | ''>('');
  const [days, setDays] = useState<number>(7);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page | 'loading' | 'error'>('loading');

  useEffect(() => {
    setData('loading');
    api
      .flagged({ ...(reason ? { reason } : {}), days, page })
      .then(setData, () => setData('error'));
  }, [api, reason, days, page]);

  return (
    <section>
      <h1>{t(lang, 'portal.nav.flagged')}</h1>
      <div class="tm-filters">
        <label>
          <span class="tm-visually-hidden">{t(lang, 'portal.flagged.reasons')}</span>
          <select
            value={reason}
            onChange={(e) => {
              setReason((e.currentTarget as HTMLSelectElement).value as FlagReason | '');
              setPage(0);
            }}
          >
            <option value="">{t(lang, 'portal.flagged.allReasons')}</option>
            {FLAG_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(lang, `portal.reasons.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span class="tm-visually-hidden">{t(lang, 'portal.flagged.lastFlag')}</span>
          <select
            value={String(days)}
            onChange={(e) => {
              setDays(Number((e.currentTarget as HTMLSelectElement).value));
              setPage(0);
            }}
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={String(d)}>
                {t(lang, 'portal.flagged.period', { days: d })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data === 'loading' && <p role="status">{t(lang, 'portal.loading')}</p>}
      {data === 'error' && <p role="alert">{t(lang, 'portal.error')}</p>}
      {typeof data === 'object' && data.conversations.length === 0 && (
        <p>{t(lang, 'portal.flagged.empty')}</p>
      )}
      {typeof data === 'object' && data.conversations.length > 0 && (
        <table class="tm-table">
          <thead>
            <tr>
              <th scope="col">{t(lang, 'portal.flagged.lastFlag')}</th>
              <th scope="col">{t(lang, 'portal.flagged.reasons')}</th>
              <th scope="col">{t(lang, 'portal.flagged.messages')}</th>
              <th scope="col">{t(lang, 'portal.flagged.ticket')}</th>
              <th scope="col">{t(lang, 'portal.flagged.loggedIn')}</th>
              <th scope="col">
                <span class="tm-visually-hidden">{t(lang, 'portal.flagged.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.conversations.map((c) => (
              <tr key={c.conversationId}>
                <td>{formatDate(lang, c.lastFlagAt)}</td>
                <td>{c.reasons.map((r) => t(lang, `portal.reasons.${r}`)).join(', ')}</td>
                <td>{c.userMessageCount}</td>
                <td>{c.escalated ? t(lang, 'portal.flagged.yes') : ''}</td>
                <td>{c.loggedIn ? t(lang, 'portal.flagged.yes') : ''}</td>
                <td>
                  <a href={`#/conversations/${c.conversationId}`}>
                    {t(lang, 'portal.flagged.open')}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {typeof data === 'object' && (
        <div class="tm-pager">
          <button
            type="button"
            class="tm-button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            {t(lang, 'portal.flagged.previous')}
          </button>
          <button
            type="button"
            class="tm-button"
            disabled={data.conversations.length < data.pageSize}
            onClick={() => setPage(page + 1)}
          >
            {t(lang, 'portal.flagged.next')}
          </button>
        </div>
      )}
    </section>
  );
}
