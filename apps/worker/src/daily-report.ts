import {
  buildDailyReport,
  type Cluster,
  fallbackTopics,
  MAX_CLUSTER_QUESTIONS,
  type TopicWithExamples,
  topicsFromClusters,
} from '@trainmore/core';
import type { MetricsRepository } from '@trainmore/db';
import type { EmailSender } from '@trainmore/email';
import { amsterdamDay, amsterdamDayBounds, type Logger, shiftDay } from '@trainmore/shared';

/** Questions read per day; the first MAX_CLUSTER_QUESTIONS are clustered, the rest grouped by reason. */
const MAX_QUESTIONS = 2000;

export type DailyReportResult =
  | { status: 'sent'; day: string; topics: number; clustered: boolean }
  | { status: 'skipped'; day: string };

/**
 * Sends the report about one Amsterdam calendar day (default: yesterday) once. The day is
 * claimed first so parallel or retried runs never send twice; a failed send releases it.
 * Logs carry the day and counts only.
 */
export async function runDailyReport(
  deps: {
    metrics: MetricsRepository;
    /** Null when clustering is unavailable; questions are raw (the clusterer masks them). */
    cluster: (questions: string[]) => Promise<Cluster[] | null>;
    email: Pick<EmailSender, 'sendDailyReport'>;
    logger: Logger;
    now: () => Date;
  },
  options: {
    day?: string;
    resend: boolean;
    recipients: string[];
    lang: 'nl' | 'en';
    portalBaseUrl: string;
  },
): Promise<DailyReportResult> {
  const day = options.day ?? shiftDay(amsterdamDay(deps.now()), -1);
  if (!(await deps.metrics.claimReport(day, options.resend))) {
    deps.logger.info({ day }, 'daily report already sent; skipped');
    return { status: 'skipped', day };
  }

  try {
    const { start, end } = amsterdamDayBounds(day);
    const [metrics] = await deps.metrics.dailyMetrics(day, day);
    if (!metrics) throw new Error('no metrics row for the day');
    const questions = await deps.metrics.flaggedQuestions(start, end, MAX_QUESTIONS);

    const head = questions.slice(0, MAX_CLUSTER_QUESTIONS);
    const rest = questions.slice(MAX_CLUSTER_QUESTIONS);
    const clusters = head.length > 0 ? await deps.cluster(head.map((q) => q.question)) : [];
    const clustered = clusters !== null;
    const topics: TopicWithExamples[] = [
      ...(clusters ? topicsFromClusters(head, clusters) : fallbackTopics(head)),
      ...fallbackTopics(rest),
    ];

    const { subject, text } = buildDailyReport({
      day,
      metrics,
      topics,
      clustered,
      lang: options.lang,
      portalBaseUrl: options.portalBaseUrl,
    });
    await deps.email.sendDailyReport({ to: options.recipients, subject, text });
    await deps.metrics.finishReport(day, {
      recipientsCount: options.recipients.length,
      clustered,
      // Stored without the example questions: labels, counts and ids only.
      topics: topics.map(({ examples: _examples, ...stored }) => stored),
    });
    deps.logger.info(
      { day, questions: questions.length, topics: topics.length, clustered },
      'daily report sent',
    );
    return { status: 'sent', day, topics: topics.length, clustered };
  } catch (error) {
    await deps.metrics.releaseReport(day);
    deps.logger.error(
      { day, error: error instanceof Error ? error.name : 'unknown' },
      'daily report failed',
    );
    throw error;
  }
}
