import { FLAG_REASONS, type FlaggedQuestion, type ReportTopic } from '@trainmore/db';
import { t } from '@trainmore/i18n';
import type { Cluster } from './cluster.ts';
import { exampleText } from './text.ts';

const MAX_EXAMPLES = 2;

/** A topic for the email: the stored part (labels, counts, ids) plus masked example questions. */
export type TopicWithExamples = ReportTopic & { examples: string[] };

function topic(labelNl: string, labelEn: string, items: FlaggedQuestion[]): TopicWithExamples {
  return {
    labelNl,
    labelEn,
    count: items.length,
    conversationIds: [...new Set(items.map((item) => item.conversationId))],
    examples: items.slice(0, MAX_EXAMPLES).map((item) => exampleText(item.question)),
  };
}

const biggestFirst = (topics: TopicWithExamples[]) =>
  topics
    .map((x, i) => ({ x, i }))
    .sort((a, b) => b.x.count - a.x.count || a.i - b.i)
    .map(({ x }) => x);

/** Topics from the model's clusters (indexes into `questions`). */
export function topicsFromClusters(
  questions: FlaggedQuestion[],
  clusters: Cluster[],
): TopicWithExamples[] {
  return biggestFirst(
    clusters.map((cluster) =>
      topic(
        cluster.labelNl,
        cluster.labelEn,
        cluster.indexes.flatMap((i) => (questions[i] ? [questions[i]] : [])),
      ),
    ),
  );
}

/**
 * Without the model: one topic per question's main flag reason (the first in FLAG_REASONS
 * order), labelled like the portal.
 */
export function fallbackTopics(questions: FlaggedQuestion[]): TopicWithExamples[] {
  const groups = new Map<string, FlaggedQuestion[]>();
  for (const question of questions) {
    const reason = FLAG_REASONS.find((r) => question.reasons.includes(r));
    if (!reason) continue;
    groups.set(reason, [...(groups.get(reason) ?? []), question]);
  }
  return biggestFirst(
    [...groups].map(([reason, items]) =>
      topic(
        t('nl', `portal.reasons.${reason}` as Parameters<typeof t>[1]),
        t('en', `portal.reasons.${reason}` as Parameters<typeof t>[1]),
        items,
      ),
    ),
  );
}
