import {
  buildDailyReport,
  type Cluster,
  type CreateClient,
  clusterQuestions,
  fallbackTopics,
  MAX_CLUSTER_QUESTIONS,
  type TopicWithExamples,
  topicsFromClusters,
} from '@trainmore/core';
import type { MetricsRepository, ReportTopic } from '@trainmore/db';
import type { EmailSender } from '@trainmore/email';
import { amsterdamDay, amsterdamDayBounds, type Logger, shiftDay } from '@trainmore/shared';

/** Questions read per day; the first MAX_CLUSTER_QUESTIONS are clustered, the rest grouped by reason. */
const MAX_QUESTIONS = 2000;
/** Attempts to record a sent report before giving up (the email is never sent again for it). */
const FINISH_ATTEMPTS = 3;

export type DailyReportResult =
  | { status: 'sent'; day: string; topics: number; clustered: boolean; claimLost: boolean }
  | { status: 'skipped'; day: string };

/**
 * Clustering with a Claude client created on first use: a missing key or any client error means
 * null (fallback grouping), so the report is still sent.
 */
export function createReportClusterer(
  makeClient: () => CreateClient,
  model: string,
): (questions: string[]) => Promise<Cluster[] | null> {
  let client: CreateClient | null = null;
  return async (questions) => {
    try {
      client ??= makeClient();
    } catch {
      return null;
    }
    return clusterQuestions({ client, model }, questions);
  };
}

/**
 * Sends the report about one Amsterdam calendar day (default: yesterday) once. The day is
 * claimed first (with a token) so parallel or retried runs do not send it again; a failed send
 * releases it. Once the email went out the claim is never released, so at worst a crash between
 * sending and recording leads to one repeat after the 15-minute stale-claim window
 * (at-least-once). Logs carry the day and counts only.
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
  const claimId = await deps.metrics.claimReport(day, options.resend);
  if (claimId === null) {
    deps.logger.info({ day }, 'daily report already sent; skipped');
    return { status: 'skipped', day };
  }

  let topics: TopicWithExamples[];
  let clustered: boolean;
  let questionCount: number;
  try {
    const { start, end } = amsterdamDayBounds(day);
    const [metrics] = await deps.metrics.dailyMetrics(day, day);
    if (!metrics) throw new Error('no metrics row for the day');
    const questions = await deps.metrics.flaggedQuestions(start, end, MAX_QUESTIONS);
    questionCount = questions.length;

    const head = questions.slice(0, MAX_CLUSTER_QUESTIONS);
    const clusters = head.length > 0 ? await deps.cluster(head.map((q) => q.question)) : [];
    clustered = clusters !== null;
    topics = clusters
      ? [
          ...topicsFromClusters(head, clusters),
          ...fallbackTopics(questions.slice(MAX_CLUSTER_QUESTIONS)),
        ]
      : fallbackTopics(questions);

    const { subject, text } = buildDailyReport({
      day,
      metrics,
      topics,
      clustered,
      lang: options.lang,
      portalBaseUrl: options.portalBaseUrl,
    });
    await deps.email.sendDailyReport({ to: options.recipients, subject, text });
  } catch (error) {
    // Nothing was sent: give the day back so the next run can retry it.
    try {
      await deps.metrics.releaseReport(day, claimId);
    } catch {
      deps.logger.error({ day }, 'daily report: releasing the day failed');
    }
    deps.logger.error(
      { day, error: error instanceof Error ? error.name : 'unknown' },
      'daily report failed',
    );
    throw error;
  }

  // Sent: record it. Stored without the example questions (labels, counts and ids only).
  const stored: ReportTopic[] = topics.map(({ examples: _examples, ...rest }) => rest);
  const claimed = await finishWithRetry(deps, day, claimId, {
    recipientsCount: options.recipients.length,
    clustered,
    topics: stored,
  });
  if (!claimed) deps.logger.warn({ day }, 'daily report sent, but another run had taken the day');
  deps.logger.info(
    { day, questions: questionCount, topics: topics.length, clustered },
    'daily report sent',
  );
  return { status: 'sent', day, topics: topics.length, clustered, claimLost: !claimed };
}

async function finishWithRetry(
  deps: { metrics: MetricsRepository; logger: Logger },
  day: string,
  claimId: string,
  input: Parameters<MetricsRepository['finishReport']>[2],
): Promise<boolean> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await deps.metrics.finishReport(day, claimId, input);
    } catch (error) {
      if (attempt >= FINISH_ATTEMPTS) {
        // The claim stays (never released after a send); the email is not sent again before
        // the stale-claim window.
        deps.logger.error({ day }, 'daily report sent, but recording it failed');
        throw error;
      }
    }
  }
}
