import { z } from 'zod';
import { DbError, type ServiceClient } from './client.ts';
import { FLAG_REASONS, type FlagReason } from './conversation-types.ts';

/** One Amsterdam calendar day; definitions in ARCHITECTURE §3.6 and the migration. */
export type DailyMetrics = {
  day: string;
  conversations: number;
  resolved: number;
  escalations: number;
  thumbsUp: number;
  thumbsDown: number;
  approvedAnswers: number;
  logins: number;
  flags: Partial<Record<FlagReason, number>>;
};

/** Unmasked customer text: mask it before it leaves the server. */
export type FlaggedQuestion = {
  conversationId: string;
  messageId: number;
  reasons: FlagReason[];
  question: string;
};

/** Labels, counts and ids only — never customer text. */
export type ReportTopic = {
  labelNl: string;
  labelEn: string;
  count: number;
  conversationIds: string[];
};

export type DailyReport = {
  day: string;
  sentAt: string | null;
  recipientsCount: number | null;
  clustered: boolean | null;
  topics: ReportTopic[];
};

export const MAX_METRICS_DAYS = 92;

export interface MetricsRepository {
  /** Inclusive range of `YYYY-MM-DD` days, at most 92 (refused by the database otherwise). */
  dailyMetrics(from: string, to: string): Promise<DailyMetrics[]>;
  flaggedQuestions(from: Date, to: Date, limit: number): Promise<FlaggedQuestion[]>;
  /** True when this run may send the day's report (see claim_daily_report). */
  claimReport(day: string, resend: boolean): Promise<boolean>;
  finishReport(
    day: string,
    input: { recipientsCount: number; clustered: boolean; topics: ReportTopic[] },
  ): Promise<void>;
  releaseReport(day: string): Promise<void>;
  /** Null when no report was sent for that day. */
  getReport(day: string): Promise<DailyReport | null>;
}

const metricsRow = z.object({
  day: z.string(),
  conversations: z.number(),
  resolved: z.number(),
  escalations: z.number(),
  thumbs_up: z.number(),
  thumbs_down: z.number(),
  approved_answers: z.number(),
  logins: z.number(),
  flags: z.partialRecord(z.enum(FLAG_REASONS), z.number()),
});

const flaggedRow = z.object({
  conversation_id: z.string(),
  message_id: z.number(),
  reasons: z.array(z.enum(FLAG_REASONS)),
  question: z.string(),
});

export const reportTopicSchema = z.object({
  labelNl: z.string(),
  labelEn: z.string(),
  count: z.number().int().nonnegative(),
  conversationIds: z.array(z.string()),
});

const reportRow = z.object({
  day: z.string(),
  sent_at: z.string().nullable(),
  recipients_count: z.number().nullable(),
  clustered: z.boolean().nullable(),
  topics: z.array(reportTopicSchema),
});

export function createSupabaseMetricsRepository(client: ServiceClient): MetricsRepository {
  return {
    async dailyMetrics(from, to) {
      const { data, error } = await client.rpc('daily_metrics', { p_from: from, p_to: to });
      if (error) throw new DbError('daily_metrics', error.code);
      return z
        .array(metricsRow)
        .parse(data ?? [])
        .map((row) => ({
          day: row.day,
          conversations: row.conversations,
          resolved: row.resolved,
          escalations: row.escalations,
          thumbsUp: row.thumbs_up,
          thumbsDown: row.thumbs_down,
          approvedAnswers: row.approved_answers,
          logins: row.logins,
          flags: row.flags,
        }));
    },

    async flaggedQuestions(from, to, limit) {
      const { data, error } = await client.rpc('flagged_questions', {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_limit: limit,
      });
      if (error) throw new DbError('flagged_questions', error.code);
      return z
        .array(flaggedRow)
        .parse(data ?? [])
        .map((row) => ({
          conversationId: row.conversation_id,
          messageId: row.message_id,
          reasons: row.reasons,
          question: row.question,
        }));
    },

    async claimReport(day, resend) {
      const { data, error } = await client.rpc('claim_daily_report', {
        p_day: day,
        p_resend: resend,
      });
      if (error) throw new DbError('claim_daily_report', error.code);
      return z.boolean().parse(data);
    },

    async finishReport(day, input) {
      const { error } = await client.rpc('finish_daily_report', {
        p_day: day,
        p_recipients_count: input.recipientsCount,
        p_clustered: input.clustered,
        p_topics: input.topics,
      });
      if (error) throw new DbError('finish_daily_report', error.code);
    },

    async releaseReport(day) {
      const { error } = await client.rpc('release_daily_report', { p_day: day });
      if (error) throw new DbError('release_daily_report', error.code);
    },

    async getReport(day) {
      const { data, error } = await client
        .from('daily_reports')
        .select('day, sent_at, recipients_count, clustered, topics')
        .eq('day', day)
        .not('sent_at', 'is', null)
        .maybeSingle();
      if (error) throw new DbError('daily_reports select', error.code);
      if (!data) return null;
      const row = reportRow.parse(data);
      return {
        day: row.day,
        sentAt: row.sent_at,
        recipientsCount: row.recipients_count,
        clustered: row.clustered,
        topics: row.topics,
      };
    },
  };
}
