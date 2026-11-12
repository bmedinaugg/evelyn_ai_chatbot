import type { DailyMetrics } from '@trainmore/db';
import { type Lang, t } from '@trainmore/i18n';
import type { TopicWithExamples } from './topics.ts';

const rate = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';

/**
 * The daily report email (plain text). Labels and examples were made safe upstream
 * (isSafeLabel, exampleText); everything else is numbers and fixed texts.
 */
export function buildDailyReport(input: {
  day: string;
  metrics: DailyMetrics;
  topics: TopicWithExamples[];
  clustered: boolean;
  lang: Lang;
  portalBaseUrl: string;
}): { subject: string; text: string } {
  const { day, metrics: m, lang } = input;
  const flagged = input.topics.reduce((sum, topic) => sum + topic.count, 0);
  const rated = m.thumbsUp + m.thumbsDown;
  const base = input.portalBaseUrl.replace(/\/+$/, '');
  const flagList = Object.entries(m.flags)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([reason, n]) => `${t(lang, `portal.reasons.${reason}` as Parameters<typeof t>[1])} ${n}`)
    .join(', ');

  const lines = [
    t(lang, 'report.heading', { day }),
    '',
    t(lang, 'report.conversations', { count: m.conversations }),
    t(lang, 'report.resolved', { count: m.resolved, rate: rate(m.resolved, m.conversations) }),
    t(lang, 'report.escalated', {
      count: m.escalations,
      rate: rate(m.escalations, m.conversations),
    }),
    rated > 0
      ? t(lang, 'report.satisfaction', {
          rate: rate(m.thumbsUp, rated),
          up: m.thumbsUp,
          total: rated,
        })
      : t(lang, 'report.satisfactionNone'),
    t(lang, 'report.approvedAnswers', { count: m.approvedAnswers }),
    t(lang, 'report.logins', { count: m.logins }),
    ...(flagList ? [t(lang, 'report.flags', { list: flagList })] : []),
    '',
    t(lang, 'report.topicsHeading', { count: flagged }),
    ...(input.clustered ? [] : [t(lang, 'report.notClustered')]),
    '',
  ];

  if (input.topics.length === 0) {
    lines.push(t(lang, 'report.noFlags'), '');
  } else {
    input.topics.forEach((topic, i) => {
      lines.push(`${i + 1}. ${lang === 'nl' ? topic.labelNl : topic.labelEn} — ${topic.count}`);
      for (const example of topic.examples) lines.push(`   "${example}"`);
      lines.push('');
    });
  }

  lines.push(
    t(lang, 'report.flaggedLink', { url: `${base}/portal/#/flagged?day=${day}` }),
    t(lang, 'report.metricsLink', { url: `${base}/portal/#/metrics` }),
    '',
    t(lang, 'report.privacyNote'),
  );

  return {
    subject: t(lang, 'report.subject', {
      day,
      conversations: m.conversations,
      flagged,
    }),
    text: lines.join('\n'),
  };
}
