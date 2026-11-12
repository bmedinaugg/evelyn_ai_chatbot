import { type Lang, type MessageKey, t } from '@trainmore/i18n';
import { useEffect, useState } from 'preact/hooks';
import type { Capability, PortalApi } from '../lib/api.ts';

const KNOWN = [
  'get_memberships',
  'get_account_balance',
  'get_upcoming_payments',
  'get_recent_visits',
  'get_class_bookings',
] as const;
type Known = (typeof KNOWN)[number];
const isKnown = (name: string): name is Known => (KNOWN as readonly string[]).includes(name);

export function CapabilitiesPage(props: { api: PortalApi; lang: Lang; isAdmin: boolean }) {
  const { api, lang } = props;
  const [list, setList] = useState<Capability[] | 'loading' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.capabilities().then(
      (r) => setList(r.capabilities),
      () => setList('error'),
    );
  }, [api]);

  async function toggle(capability: Capability) {
    setBusy(capability.name);
    try {
      await api.setCapability(capability.name, !capability.enabled);
      setList((current) =>
        Array.isArray(current)
          ? current.map((c) => (c.name === capability.name ? { ...c, enabled: !c.enabled } : c))
          : current,
      );
    } catch {
      setList('error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h1>{t(lang, 'portal.nav.capabilities')}</h1>
      <p>{t(lang, 'portal.capabilities.intro')}</p>
      {!props.isAdmin && <p class="tm-notice">{t(lang, 'portal.capabilities.adminOnly')}</p>}
      {list === 'loading' && <p role="status">{t(lang, 'portal.loading')}</p>}
      {list === 'error' && <p role="alert">{t(lang, 'portal.error')}</p>}
      {Array.isArray(list) &&
        list
          .filter((c) => isKnown(c.name))
          .map((c) => {
            const name = c.name as Known;
            const title = t(lang, `portal.capabilities.${name}` as MessageKey);
            const headingId = `cap-${name}`;
            return (
              <section key={name} class="tm-card" aria-labelledby={headingId}>
                <h2 id={headingId}>{title}</h2>
                <p class={c.enabled ? 'tm-state tm-state--on' : 'tm-state'}>
                  {t(lang, c.enabled ? 'portal.capabilities.on' : 'portal.capabilities.off')}
                </p>
                <p>
                  {t(lang, 'portal.capabilities.appliesTo', {
                    statuses: c.statuses.map((s) => t(lang, `widget.status.${s}`)).join(', '),
                  })}
                </p>
                <h3>{t(lang, 'portal.capabilities.examples')}</h3>
                <ul>
                  {t(lang, `portal.capabilities.${name}_examples` as MessageKey)
                    .split('\n')
                    .map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                </ul>
                {props.isAdmin && (
                  <button
                    type="button"
                    class="tm-button"
                    disabled={busy === name}
                    onClick={() => toggle(c)}
                  >
                    {t(
                      lang,
                      c.enabled ? 'portal.capabilities.switchOff' : 'portal.capabilities.switchOn',
                    )}
                  </button>
                )}
              </section>
            );
          })}
    </section>
  );
}
