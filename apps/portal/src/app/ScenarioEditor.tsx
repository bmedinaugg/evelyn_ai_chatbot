import { type Lang, t } from '@trainmore/i18n';
import { useState } from 'preact/hooks';
import type { PortalApi, ScenarioContent } from '../lib/api.ts';

const STATUSES = ['MEMBER', 'PROSPECT', 'FORMER_MEMBER'] as const;
const MAX = 1200;

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** A new scenario, or a new version of one (`scenarioId`), always saved as a draft. */
export function ScenarioEditor(props: {
  api: PortalApi;
  lang: Lang;
  scenarioId?: string;
  initial?: ScenarioContent;
  onSaved: (scenarioId: string) => void;
  onCancel?: () => void;
}) {
  const { api, lang } = props;
  const initial = props.initial;
  const [triggersNl, setTriggersNl] = useState(initial?.triggersNl.join('\n') ?? '');
  const [triggersEn, setTriggersEn] = useState(initial?.triggersEn.join('\n') ?? '');
  const [answerNl, setAnswerNl] = useState(initial?.answerNl ?? '');
  const [answerEn, setAnswerEn] = useState(initial?.answerEn ?? '');
  const [statuses, setStatuses] = useState<ScenarioContent['statuses']>(initial?.statuses ?? []);
  const [articleId, setArticleId] = useState(initial?.articleId ? String(initial.articleId) : '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'invalid' | 'error'>('idle');

  async function save(event: Event) {
    event.preventDefault();
    const content: ScenarioContent = {
      triggersNl: lines(triggersNl),
      triggersEn: lines(triggersEn),
      answerNl: answerNl.trim(),
      answerEn: answerEn.trim(),
      statuses,
      articleId: /^\d+$/.test(articleId.trim()) ? Number(articleId.trim()) : null,
    };
    if (
      content.triggersNl.length === 0 ||
      content.triggersEn.length === 0 ||
      !content.answerNl ||
      !content.answerEn
    ) {
      setState('invalid');
      return;
    }
    setState('saving');
    try {
      const scenarioId = props.scenarioId
        ? (await api.addVersion(props.scenarioId, content), props.scenarioId)
        : (await api.createScenario(content)).scenarioId;
      setState('saved');
      props.onSaved(scenarioId);
    } catch {
      setState('error');
    }
  }

  const value = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;

  return (
    <form class="tm-editor" onSubmit={save} aria-labelledby="tm-editor-title">
      <h2 id="tm-editor-title">{t(lang, 'portal.scenarios.editorTitle')}</h2>
      <p class="tm-notice">{t(lang, 'portal.scenarios.noPersonalData')}</p>
      <div class="tm-columns">
        <div>
          <label for="tm-triggers-nl">{t(lang, 'portal.scenarios.triggersNl')}</label>
          <textarea
            id="tm-triggers-nl"
            rows={4}
            value={triggersNl}
            onInput={(e) => setTriggersNl(value(e))}
          />
          <label for="tm-answer-nl">{t(lang, 'portal.scenarios.answerNl')}</label>
          <textarea
            id="tm-answer-nl"
            rows={6}
            maxLength={MAX}
            value={answerNl}
            onInput={(e) => setAnswerNl(value(e))}
            aria-describedby="tm-answer-nl-count"
          />
          <p id="tm-answer-nl-count" class="tm-hint">
            {t(lang, 'portal.scenarios.characters', { count: answerNl.length })}
          </p>
        </div>
        <div>
          <label for="tm-triggers-en">{t(lang, 'portal.scenarios.triggersEn')}</label>
          <textarea
            id="tm-triggers-en"
            rows={4}
            value={triggersEn}
            onInput={(e) => setTriggersEn(value(e))}
          />
          <label for="tm-answer-en">{t(lang, 'portal.scenarios.answerEn')}</label>
          <textarea
            id="tm-answer-en"
            rows={6}
            maxLength={MAX}
            value={answerEn}
            onInput={(e) => setAnswerEn(value(e))}
            aria-describedby="tm-answer-en-count"
          />
          <p id="tm-answer-en-count" class="tm-hint">
            {t(lang, 'portal.scenarios.characters', { count: answerEn.length })}
          </p>
        </div>
      </div>
      <fieldset>
        <legend>{t(lang, 'portal.scenarios.audience')}</legend>
        <p class="tm-hint">{t(lang, 'portal.scenarios.everyone')}</p>
        {STATUSES.map((status) => (
          <label key={status} class="tm-check">
            <input
              type="checkbox"
              checked={statuses.includes(status)}
              onChange={(e) =>
                setStatuses((current) =>
                  (e.currentTarget as HTMLInputElement).checked
                    ? [...current, status]
                    : current.filter((s) => s !== status),
                )
              }
            />
            {t(lang, `widget.status.${status}`)}
          </label>
        ))}
      </fieldset>
      <label for="tm-article">{t(lang, 'portal.scenarios.articleId')}</label>
      <input
        id="tm-article"
        inputMode="numeric"
        value={articleId}
        onInput={(e) => setArticleId(value(e))}
      />
      {state === 'invalid' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'portal.scenarios.invalid')}
        </p>
      )}
      {state === 'error' && (
        <p class="tm-notice" role="alert">
          {t(lang, 'portal.error')}
        </p>
      )}
      {state === 'saved' && (
        <p class="tm-notice" role="status">
          {t(lang, 'portal.scenarios.saved')}
        </p>
      )}
      <div class="tm-row">
        {props.onCancel && (
          <button type="button" class="tm-button" onClick={props.onCancel}>
            {t(lang, 'portal.scenarios.cancel')}
          </button>
        )}
        <button type="submit" class="tm-button tm-button--primary" disabled={state === 'saving'}>
          {t(lang, 'portal.scenarios.saveDraft')}
        </button>
      </div>
    </form>
  );
}
