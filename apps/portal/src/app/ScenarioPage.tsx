import { type Lang, t } from '@trainmore/i18n';
import { useEffect, useState } from 'preact/hooks';
import type { PortalApi, Scenario, ScenarioContent } from '../lib/api.ts';
import { formatDate } from './FlaggedPage.tsx';
import { ScenarioEditor } from './ScenarioEditor.tsx';

type Notice = 'published' | 'own_version' | 'archived' | 'saved' | 'error' | null;

export function ScenarioPage(props: {
  api: PortalApi;
  lang: Lang;
  id: string;
  isApprover: boolean;
  /** Just created from the editor: confirm it. */
  justSaved?: boolean;
}) {
  const { api, lang, id } = props;
  const [data, setData] = useState<Scenario | 'loading' | 'error'>('loading');
  const [notice, setNotice] = useState<Notice>(props.justSaved ? 'saved' : null);
  const [editFrom, setEditFrom] = useState<ScenarioContent | null>(null);

  const load = () => api.scenario(id).then(setData, () => setData('error'));
  useEffect(() => {
    load();
  }, [api, id]);

  async function publish(versionId: number) {
    try {
      const result = await api.publish(versionId);
      setNotice(result === 'ok' ? 'published' : 'own_version');
      await load();
    } catch {
      setNotice('error');
    }
  }

  async function archive() {
    try {
      await api.archive(id);
      setNotice('archived');
      await load();
    } catch {
      setNotice('error');
    }
  }

  if (data === 'loading') return <p role="status">{t(lang, 'portal.loading')}</p>;
  if (data === 'error') return <p role="alert">{t(lang, 'portal.error')}</p>;
  const latest = data.versions.at(-1);

  return (
    <section>
      <p>
        <a href="#/scenarios">{t(lang, 'portal.nav.scenarios')}</a>
      </p>
      <h1>{lang === 'nl' ? latest?.triggersNl[0] : latest?.triggersEn[0]}</h1>
      {data.archived && <p class="tm-notice">{t(lang, 'portal.scenarios.archived')}</p>}
      {!props.isApprover && <p class="tm-notice">{t(lang, 'portal.scenarios.approverOnly')}</p>}
      {notice === 'published' && <p role="status">{t(lang, 'portal.scenarios.published')}</p>}
      {notice === 'archived' && <p role="status">{t(lang, 'portal.scenarios.archivedDone')}</p>}
      {notice === 'saved' && <p role="status">{t(lang, 'portal.scenarios.saved')}</p>}
      {notice === 'own_version' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'portal.scenarios.ownVersion')}
        </p>
      )}
      {notice === 'error' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'portal.error')}
        </p>
      )}
      {props.isApprover && !data.archived && (
        <p>
          <button type="button" class="tm-button" onClick={archive}>
            {t(lang, 'portal.scenarios.archive')}
          </button>
        </p>
      )}
      {editFrom && (
        <ScenarioEditor
          api={api}
          lang={lang}
          scenarioId={id}
          initial={editFrom}
          onCancel={() => setEditFrom(null)}
          onSaved={() => {
            setEditFrom(null);
            setNotice('saved');
            load();
          }}
        />
      )}
      <h2>{t(lang, 'portal.scenarios.versions')}</h2>
      {[...data.versions].reverse().map((v) => {
        const headingId = `version-${v.id}`;
        return (
          <section key={v.id} class="tm-card" aria-labelledby={headingId}>
            <h3 id={headingId}>{t(lang, 'portal.scenarios.version', { number: v.version })}</h3>
            <p class={v.status === 'published' ? 'tm-state tm-state--on' : 'tm-state'}>
              {t(lang, `portal.scenarios.status_${v.status}`)}
            </p>
            <p class="tm-hint">
              {t(lang, 'portal.scenarios.writtenBy', { name: v.authorName })} ·{' '}
              {formatDate(lang, v.createdAt)}
              {v.publishedByName &&
                ` · ${t(lang, 'portal.scenarios.publishedBy', { name: v.publishedByName })}`}
            </p>
            <div class="tm-columns">
              <div>
                <ul>
                  {v.triggersNl.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
                <p class="tm-message__text">{v.answerNl}</p>
              </div>
              <div>
                <ul>
                  {v.triggersEn.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
                <p class="tm-message__text">{v.answerEn}</p>
              </div>
            </div>
            <div class="tm-row">
              {props.isApprover && !data.archived && v.status === 'draft' && (
                <button
                  type="button"
                  class="tm-button tm-button--primary"
                  onClick={() => publish(v.id)}
                >
                  {t(lang, 'portal.scenarios.publish')}
                </button>
              )}
              {props.isApprover && !data.archived && v.status === 'superseded' && (
                <button type="button" class="tm-button" onClick={() => publish(v.id)}>
                  {t(lang, 'portal.scenarios.restore')}
                </button>
              )}
              {!data.archived && (
                <button
                  type="button"
                  class="tm-button"
                  onClick={() =>
                    setEditFrom({
                      triggersNl: v.triggersNl,
                      triggersEn: v.triggersEn,
                      answerNl: v.answerNl,
                      answerEn: v.answerEn,
                      statuses: v.statuses,
                      articleId: v.articleId,
                    })
                  }
                >
                  {t(lang, 'portal.scenarios.newVersion')}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </section>
  );
}
