import { type Lang, t } from '@trainmore/i18n';
import { useEffect, useState } from 'preact/hooks';
import type { PortalApi, ScenarioSummary } from '../lib/api.ts';

export function ScenariosPage(props: { api: PortalApi; lang: Lang }) {
  const { api, lang } = props;
  const [list, setList] = useState<ScenarioSummary[] | 'loading' | 'error'>('loading');

  useEffect(() => {
    api.scenarios().then(
      (r) => setList(r.scenarios),
      () => setList('error'),
    );
  }, [api]);

  return (
    <section>
      <h1>{t(lang, 'portal.nav.scenarios')}</h1>
      <p>{t(lang, 'portal.scenarios.intro')}</p>
      <p>
        <a class="tm-button tm-button--primary" href="#/scenarios/new">
          {t(lang, 'portal.scenarios.new')}
        </a>
      </p>
      {list === 'loading' && <p role="status">{t(lang, 'portal.loading')}</p>}
      {list === 'error' && <p role="alert">{t(lang, 'portal.error')}</p>}
      {Array.isArray(list) && list.length === 0 && <p>{t(lang, 'portal.scenarios.empty')}</p>}
      {Array.isArray(list) && list.length > 0 && (
        <table class="tm-table">
          <thead>
            <tr>
              <th scope="col">{t(lang, 'portal.scenarios.question')}</th>
              <th scope="col">{t(lang, 'portal.scenarios.live')}</th>
              <th scope="col">{t(lang, 'portal.scenarios.latest')}</th>
              <th scope="col">
                <span class="tm-visually-hidden">{t(lang, 'portal.scenarios.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  {lang === 'nl' ? s.firstTriggerNl : s.firstTriggerEn}
                  {s.archived && ` · ${t(lang, 'portal.scenarios.archived')}`}
                </td>
                <td>{s.publishedVersion ?? t(lang, 'portal.scenarios.none')}</td>
                <td>{s.latestVersion}</td>
                <td>
                  <a href={`#/scenarios/${s.id}`}>{t(lang, 'portal.scenarios.open')}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
