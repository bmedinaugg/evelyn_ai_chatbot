import { type Lang, t } from '@trainmore/i18n';
import { useEffect, useState } from 'preact/hooks';
import {
  type PortalApi,
  PortalApiError,
  type ReplayResult,
  type ScenarioSummary,
} from '../lib/api.ts';

/** Re-asks this conversation's questions with a draft approved answer, side by side. */
export function ReplayPanel(props: { api: PortalApi; lang: Lang; conversationId: string }) {
  const { api, lang } = props;
  const [drafts, setDrafts] = useState<ScenarioSummary[] | null>(null);
  const [versionId, setVersionId] = useState('');
  const [state, setState] = useState<'idle' | 'running' | 'unavailable' | 'error'>('idle');
  const [result, setResult] = useState<ReplayResult | null>(null);

  useEffect(() => {
    api.scenarios().then(
      (r) =>
        setDrafts(r.scenarios.filter((s) => !s.archived && s.latestVersion !== s.publishedVersion)),
      () => setDrafts([]),
    );
  }, [api]);

  async function run() {
    if (!versionId) return;
    setState('running');
    setResult(null);
    try {
      setResult(await api.replay(props.conversationId, Number(versionId), lang));
      setState('idle');
    } catch (error) {
      setState(
        error instanceof PortalApiError && error.kind === 'conflict' ? 'unavailable' : 'error',
      );
    }
  }

  return (
    <section class="tm-card" aria-labelledby="tm-replay-title">
      <h2 id="tm-replay-title">{t(lang, 'portal.replay.title')}</h2>
      <p>{t(lang, 'portal.replay.intro')}</p>
      {drafts !== null && drafts.length === 0 && <p>{t(lang, 'portal.replay.noDrafts')}</p>}
      {drafts !== null && drafts.length > 0 && (
        <div class="tm-filters">
          <label for="tm-replay-draft" class="tm-visually-hidden">
            {t(lang, 'portal.replay.choose')}
          </label>
          <select
            id="tm-replay-draft"
            value={versionId}
            onChange={(e) => setVersionId((e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">{t(lang, 'portal.replay.choose')}</option>
            {drafts.map((d) => (
              <option key={d.id} value={String(d.latestVersionId)}>
                {t(lang, 'portal.replay.option', {
                  question: lang === 'nl' ? d.firstTriggerNl : d.firstTriggerEn,
                  number: d.latestVersion,
                })}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="tm-button"
            disabled={!versionId || state === 'running'}
            onClick={run}
          >
            {t(lang, state === 'running' ? 'portal.replay.running' : 'portal.replay.run')}
          </button>
        </div>
      )}
      {state === 'unavailable' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'portal.replay.unavailable')}
        </p>
      )}
      {state === 'error' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'portal.error')}
        </p>
      )}
      {result && (
        <p class="tm-judge-summary">
          <strong>{t(lang, 'portal.replay.judge.title')}: </strong>
          {result.judgement
            ? t(lang, 'portal.replay.judge.summary', result.judgement.summary)
            : t(lang, 'portal.replay.judge.unavailable')}
        </p>
      )}
      {result && (
        <table class="tm-table">
          <thead>
            <tr>
              <th scope="col">{t(lang, 'portal.replay.question')}</th>
              <th scope="col">{t(lang, 'portal.replay.before')}</th>
              <th scope="col">{t(lang, 'portal.replay.after')}</th>
              {result.judgement && <th scope="col">{t(lang, 'portal.replay.judge.title')}</th>}
            </tr>
          </thead>
          <tbody>
            {result.results.map((r, i) => (
              <tr key={`${i}-${r.question}`}>
                <td>{r.question}</td>
                <td>{r.oldAnswer ?? t(lang, 'portal.replay.noAnswer')}</td>
                <td>
                  {r.newAnswer || t(lang, 'portal.replay.noAnswer')}
                  {r.usesDraft && (
                    <span class="tm-state tm-state--on tm-badge-gap">
                      {' '}
                      {t(lang, 'portal.replay.usesDraft')}
                    </span>
                  )}
                </td>
                {result.judgement && (
                  <td>
                    {(() => {
                      const v = result.judgement.verdicts[i];
                      if (!v) return null;
                      return (
                        <>
                          <span class={`tm-verdict tm-verdict--${v.verdict}`}>
                            {t(lang, `portal.replay.judge.${v.verdict}`)}
                          </span>{' '}
                          {v.reason}
                        </>
                      );
                    })()}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
