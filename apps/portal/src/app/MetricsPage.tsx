import { type Lang, t } from '@trainmore/i18n';
import { useEffect, useState } from 'preact/hooks';
import type { DayMetrics, Metrics, PortalApi, Report } from '../lib/api.ts';

const PERIODS = [7, 30, 90] as const;

const amsterdamToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const formatDay = (lang: Lang, day: string) =>
  new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));

const rate = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';

/** Daily numbers (Amsterdam days), a bar chart of conversations, and yesterday's report topics. */
export function MetricsPage(props: { api: PortalApi; lang: Lang }) {
  const { api, lang } = props;
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<Metrics | 'loading' | 'error'>('loading');
  const [report, setReport] = useState<Report | null | 'loading'>('loading');
  const yesterday = shiftDay(amsterdamToday(), -1);

  useEffect(() => {
    const to = amsterdamToday();
    setData('loading');
    api.metrics(shiftDay(to, -(days - 1)), to).then(setData, () => setData('error'));
  }, [api, days]);

  useEffect(() => {
    api.report(yesterday).then(setReport, () => setReport(null));
  }, [api, yesterday]);

  return (
    <section>
      <h1>{t(lang, 'portal.nav.metrics')}</h1>
      <div class="tm-filters">
        <label>
          <span class="tm-visually-hidden">{t(lang, 'portal.metrics.period', { days })}</span>
          <select
            value={String(days)}
            onChange={(e) => setDays(Number((e.currentTarget as HTMLSelectElement).value))}
          >
            {PERIODS.map((d) => (
              <option key={d} value={String(d)}>
                {t(lang, 'portal.metrics.period', { days: d })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data === 'loading' && <p role="status">{t(lang, 'portal.loading')}</p>}
      {data === 'error' && <p role="alert">{t(lang, 'portal.error')}</p>}
      {typeof data === 'object' && (
        <>
          <Tiles lang={lang} totals={data.totals} />
          <Chart lang={lang} days={data.days} />
          <DayTable lang={lang} days={data.days} />
        </>
      )}
      <Topics lang={lang} day={yesterday} report={report} />
    </section>
  );
}

function Tiles(props: { lang: Lang; totals: Metrics['totals'] }) {
  const { lang, totals: m } = props;
  const rated = m.thumbsUp + m.thumbsDown;
  const tiles: { label: string; value: string; detail?: string }[] = [
    { label: t(lang, 'portal.metrics.conversations'), value: String(m.conversations) },
    {
      label: t(lang, 'portal.metrics.resolved'),
      value: rate(m.resolved, m.conversations),
      detail: `${m.resolved} ${t(lang, 'portal.metrics.ofConversations')}`,
    },
    {
      label: t(lang, 'portal.metrics.escalated'),
      value: rate(m.escalations, m.conversations),
      detail: `${m.escalations} ${t(lang, 'portal.metrics.ofConversations')}`,
    },
    {
      label: t(lang, 'portal.metrics.satisfaction'),
      value: rate(m.thumbsUp, rated),
      detail:
        rated > 0
          ? t(lang, 'portal.metrics.satisfactionDetail', { up: m.thumbsUp, total: rated })
          : t(lang, 'portal.metrics.noRatings'),
    },
    { label: t(lang, 'portal.metrics.approvedAnswers'), value: String(m.approvedAnswers) },
    { label: t(lang, 'portal.metrics.logins'), value: String(m.logins) },
  ];
  return (
    <ul class="tm-tiles">
      {tiles.map((tile) => (
        <li key={tile.label} class="tm-tile">
          <span class="tm-tile__label">{tile.label}</span>
          <span class="tm-tile__value">{tile.value}</span>
          {tile.detail && <span class="tm-tile__detail">{tile.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

const CHART_HEIGHT = 160;
const BAR_GAP = 2;

/** One series (conversations per day); hover shows the day's numbers, the table has them all. */
function Chart(props: { lang: Lang; days: DayMetrics[] }) {
  const { lang, days } = props;
  const [active, setActive] = useState<DayMetrics | null>(null);
  const max = Math.max(1, ...days.map((d) => d.conversations));
  const width = Math.max(days.length * 24, 240);
  const step = width / Math.max(days.length, 1);
  const label = (d: DayMetrics) =>
    t(lang, 'portal.metrics.barLabel', {
      day: formatDay(lang, d.day),
      count: d.conversations,
      resolved: d.resolved,
    });

  return (
    <figure class="tm-chart">
      <figcaption>{t(lang, 'portal.metrics.chartTitle')}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t(lang, 'portal.metrics.chartTitle')}
        // Column under the pointer (the svg stretches to the page width).
        onPointerMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.floor(((e.clientX - box.left) / box.width) * days.length);
          setActive(days[Math.min(Math.max(i, 0), days.length - 1)] ?? null);
        }}
        onPointerLeave={() => setActive(null)}
      >
        <line class="tm-chart__base" x1="0" x2={width} y1={CHART_HEIGHT} y2={CHART_HEIGHT} />
        {days.map((d, i) => {
          const h = (d.conversations / max) * (CHART_HEIGHT - 8);
          return (
            <g key={d.day}>
              <rect
                class={`tm-chart__bar${active?.day === d.day ? ' tm-chart__bar--active' : ''}`}
                x={i * step + BAR_GAP / 2}
                y={CHART_HEIGHT - h}
                width={Math.max(step - BAR_GAP, 1)}
                height={h}
                rx="2"
              >
                <title>{label(d)}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <p class="tm-chart__readout" aria-live="polite">
        {active ? label(active) : ' '}
      </p>
    </figure>
  );
}

function DayTable(props: { lang: Lang; days: DayMetrics[] }) {
  const { lang } = props;
  return (
    <table class="tm-table">
      <thead>
        <tr>
          <th scope="col">{t(lang, 'portal.metrics.day')}</th>
          <th scope="col">{t(lang, 'portal.metrics.conversations')}</th>
          <th scope="col">{t(lang, 'portal.metrics.resolved')}</th>
          <th scope="col">{t(lang, 'portal.metrics.escalated')}</th>
          <th scope="col">👍</th>
          <th scope="col">👎</th>
        </tr>
      </thead>
      <tbody>
        {[...props.days].reverse().map((d) => (
          <tr key={d.day}>
            <td>{formatDay(lang, d.day)}</td>
            <td>{d.conversations}</td>
            <td>{d.resolved}</td>
            <td>{d.escalations}</td>
            <td>{d.thumbsUp}</td>
            <td>{d.thumbsDown}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Topics(props: { lang: Lang; day: string; report: Report | null | 'loading' }) {
  const { lang, day, report } = props;
  const shown = formatDay(lang, day);
  if (report === 'loading') return null;
  return (
    <section class="tm-card" aria-labelledby="tm-topics-title">
      <h2 id="tm-topics-title">{t(lang, 'portal.metrics.topicsTitle', { day: shown })}</h2>
      {report === null ? (
        <p>{t(lang, 'portal.metrics.topicsNone', { day: shown })}</p>
      ) : (
        <>
          {report.clustered === false && <p>{t(lang, 'portal.metrics.notClustered')}</p>}
          <ol class="tm-topics">
            {report.topics.map((topic) => (
              <li key={`${topic.labelNl}-${topic.labelEn}`}>
                <span>{lang === 'nl' ? topic.labelNl : topic.labelEn}</span>{' '}
                <span class="tm-topics__count">
                  {t(lang, 'portal.metrics.questions', { count: topic.count })}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <a href={`#/flagged?day=${day}`}>{t(lang, 'portal.metrics.viewFlagged', { day: shown })}</a>
    </section>
  );
}
