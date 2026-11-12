import { Writable } from 'node:stream';
import type { Cluster } from '@trainmore/core';
import type { DailyMetrics, FlaggedQuestion, MetricsRepository, ReportTopic } from '@trainmore/db';
import type { ReportMessage } from '@trainmore/email';
import { createLogger } from '@trainmore/shared';
import { describe, expect, it } from 'vitest';
import { createReportClusterer, runDailyReport } from '../src/daily-report.ts';

let logOutput = '';
const logger = createLogger({
  name: 'test',
  level: 'info',
  destination: new Writable({
    write(chunk, _e, cb) {
      logOutput += chunk.toString();
      cb();
    },
  }),
});

const METRICS: DailyMetrics = {
  day: '2026-11-12',
  conversations: 5,
  resolved: 3,
  escalations: 1,
  thumbsUp: 2,
  thumbsDown: 1,
  approvedAnswers: 0,
  logins: 1,
  flags: { no_match: 2, thumbs_down: 1 },
};

const QUESTIONS: FlaggedQuestion[] = [
  {
    conversationId: 'c1',
    messageId: 2,
    reasons: ['no_match'],
    question: 'Sauna? mail jan@example.com',
  },
  { conversationId: 'c2', messageId: 4, reasons: ['thumbs_down'], question: 'Bevriezen?' },
];

function fakeMetrics(
  opts: {
    claim?: boolean;
    questions?: FlaggedQuestion[];
    /** finishReport throws this many times before it succeeds. */
    finishFailures?: number;
    claimLost?: boolean;
    releaseFails?: boolean;
  } = {},
) {
  let finishFailures = opts.finishFailures ?? 0;
  const calls: { fn: string; args: unknown[] }[] = [];
  let finished: { recipientsCount: number; clustered: boolean; topics: ReportTopic[] } | null =
    null;
  const repo: MetricsRepository = {
    async dailyMetrics(...args) {
      calls.push({ fn: 'metrics', args });
      return [METRICS];
    },
    async flaggedQuestions(...args) {
      calls.push({ fn: 'questions', args });
      return opts.questions ?? QUESTIONS;
    },
    async claimReport(...args) {
      calls.push({ fn: 'claim', args });
      return (opts.claim ?? true) ? 'claim-1' : null;
    },
    async finishReport(day, claimId, input) {
      calls.push({ fn: 'finish', args: [day, claimId] });
      if (finishFailures > 0) {
        finishFailures -= 1;
        throw new Error('db blip');
      }
      if (opts.claimLost) return false;
      finished = input;
      return true;
    },
    async releaseReport(...args) {
      calls.push({ fn: 'release', args });
      if (opts.releaseFails) throw new Error('release failed');
    },
    async getReport() {
      return null;
    },
  };
  return { repo, calls, finished: () => finished };
}

function fakeEmail(fail = false) {
  const sent: ReportMessage[] = [];
  return {
    sent,
    email: {
      async sendDailyReport(message: ReportMessage) {
        if (fail) throw new Error('SES down');
        sent.push(message);
      },
    },
  };
}

const settings = {
  recipients: ['support@example.com'],
  lang: 'nl' as const,
  portalBaseUrl: 'https://chat.example.com',
};
const NOW = () => new Date('2026-11-13T06:00:00Z'); // 07:00 in Amsterdam

describe('runDailyReport', () => {
  it("reports yesterday's Amsterdam day: clusters, sends, records topics without customer text", async () => {
    const { repo, calls, finished } = fakeMetrics();
    const { email, sent } = fakeEmail();
    const clusters: Cluster[] = [
      { labelNl: 'Faciliteiten', labelEn: 'Facilities', indexes: [0, 1] },
    ];
    let clustered: string[] = [];
    const result = await runDailyReport(
      {
        metrics: repo,
        cluster: async (questions) => {
          clustered = questions;
          return clusters;
        },
        email,
        logger,
        now: NOW,
      },
      { ...settings, resend: false },
    );

    expect(result).toEqual({
      status: 'sent',
      day: '2026-11-12',
      topics: 1,
      clustered: true,
      claimLost: false,
    });
    expect(calls.find((c) => c.fn === 'claim')?.args).toEqual(['2026-11-12', false]);
    expect(calls.find((c) => c.fn === 'metrics')?.args).toEqual(['2026-11-12', '2026-11-12']);
    expect(calls.find((c) => c.fn === 'questions')?.args.slice(0, 2)).toEqual([
      new Date('2026-11-11T23:00:00Z'),
      new Date('2026-11-12T23:00:00Z'),
    ]);
    expect(clustered).toHaveLength(2);
    expect(sent[0]?.to).toEqual(['support@example.com']);
    expect(sent[0]?.subject).toContain('2026-11-12');
    expect(sent[0]?.text).toContain('Faciliteiten — 2');
    expect(sent[0]?.text).not.toContain('jan@example.com');
    expect(finished()).toEqual({
      recipientsCount: 1,
      clustered: true,
      topics: [
        { labelNl: 'Faciliteiten', labelEn: 'Facilities', count: 2, conversationIds: ['c1', 'c2'] },
      ],
    });
    expect(logOutput).not.toContain('jan@example.com');
    expect(logOutput).not.toContain('support@example.com');
  });

  it('skips a day that was already sent', async () => {
    const { repo, calls } = fakeMetrics({ claim: false });
    const { email, sent } = fakeEmail();
    const result = await runDailyReport(
      { metrics: repo, cluster: async () => [], email, logger, now: NOW },
      { ...settings, resend: false },
    );
    expect(result).toEqual({ status: 'skipped', day: '2026-11-12' });
    expect(sent).toHaveLength(0);
    expect(calls.map((c) => c.fn)).toEqual(['claim']);
  });

  it('falls back to flag reasons when clustering fails, and still sends', async () => {
    const { repo, finished } = fakeMetrics();
    const { email, sent } = fakeEmail();
    const result = await runDailyReport(
      { metrics: repo, cluster: async () => null, email, logger, now: NOW },
      { ...settings, resend: false },
    );
    expect(result).toMatchObject({ status: 'sent', clustered: false, topics: 2 });
    expect(sent[0]?.text).toContain('Automatisch groeperen lukte vandaag niet');
    expect(finished()?.clustered).toBe(false);
  });

  it('does not call the model for a day without flagged questions', async () => {
    const { repo } = fakeMetrics({ questions: [] });
    const { email, sent } = fakeEmail();
    let called = false;
    await runDailyReport(
      {
        metrics: repo,
        cluster: async () => {
          called = true;
          return [];
        },
        email,
        logger,
        now: NOW,
      },
      { ...settings, resend: false },
    );
    expect(called).toBe(false);
    expect(sent[0]?.text).toContain('Geen gemarkeerde vragen.');
  });

  it('groups questions beyond the clustering limit by reason, so every question is counted', async () => {
    const many: FlaggedQuestion[] = Array.from({ length: 205 }, (_, i) => ({
      conversationId: `c${i}`,
      messageId: i,
      reasons: ['no_match'],
      question: `vraag ${i}`,
    }));
    const { repo, finished } = fakeMetrics({ questions: many });
    const { email } = fakeEmail();
    await runDailyReport(
      {
        metrics: repo,
        cluster: async (questions) => [
          { labelNl: 'Alles', labelEn: 'Everything', indexes: questions.map((_q, i) => i) },
        ],
        email,
        logger,
        now: NOW,
      },
      { ...settings, resend: false },
    );
    const topics = finished()?.topics ?? [];
    expect(topics.reduce((sum, t) => sum + t.count, 0)).toBe(205);
    expect(topics.map((t) => t.count)).toEqual([200, 5]);
  });

  it('releases the day when sending fails, so a retry can send it', async () => {
    const { repo, calls } = fakeMetrics();
    const { email } = fakeEmail(true);
    await expect(
      runDailyReport(
        { metrics: repo, cluster: async () => null, email, logger, now: NOW },
        { ...settings, resend: false },
      ),
    ).rejects.toThrow('SES down');
    expect(calls.map((c) => c.fn)).toContain('release');
    expect(calls.map((c) => c.fn)).not.toContain('finish');
  });

  it('never releases the day once the email went out; retries recording it', async () => {
    const { repo, calls, finished } = fakeMetrics({ finishFailures: 2 });
    const { email, sent } = fakeEmail();
    await runDailyReport(
      { metrics: repo, cluster: async () => null, email, logger, now: NOW },
      { ...settings, resend: false },
    );
    expect(sent).toHaveLength(1);
    expect(calls.filter((c) => c.fn === 'finish')).toHaveLength(3);
    expect(calls.find((c) => c.fn === 'finish')?.args).toEqual(['2026-11-12', 'claim-1']);
    expect(finished()).not.toBeNull();
    expect(calls.map((c) => c.fn)).not.toContain('release');
  });

  it('keeps the claim (no release) when recording keeps failing after the send', async () => {
    const { repo, calls } = fakeMetrics({ finishFailures: 10 });
    const { email, sent } = fakeEmail();
    await expect(
      runDailyReport(
        { metrics: repo, cluster: async () => null, email, logger, now: NOW },
        { ...settings, resend: false },
      ),
    ).rejects.toThrow('db blip');
    expect(sent).toHaveLength(1);
    expect(calls.map((c) => c.fn)).not.toContain('release');
  });

  it('reports a lost claim without failing (another run took over)', async () => {
    const { repo } = fakeMetrics({ claimLost: true });
    const { email } = fakeEmail();
    const result = await runDailyReport(
      { metrics: repo, cluster: async () => null, email, logger, now: NOW },
      { ...settings, resend: false },
    );
    expect(result).toMatchObject({ status: 'sent', claimLost: true });
  });

  it('keeps the original error when releasing also fails', async () => {
    const { repo } = fakeMetrics({ releaseFails: true });
    const { email } = fakeEmail(true);
    await expect(
      runDailyReport(
        { metrics: repo, cluster: async () => null, email, logger, now: NOW },
        { ...settings, resend: false },
      ),
    ).rejects.toThrow('SES down');
  });

  it('groups all questions by reason once when clustering fails on a busy day', async () => {
    const many: FlaggedQuestion[] = Array.from({ length: 205 }, (_, i) => ({
      conversationId: `c${i}`,
      messageId: i,
      reasons: ['no_match'],
      question: `vraag ${i}`,
    }));
    const { repo, finished } = fakeMetrics({ questions: many });
    const { email } = fakeEmail();
    await runDailyReport(
      { metrics: repo, cluster: async () => null, email, logger, now: NOW },
      { ...settings, resend: false },
    );
    expect(finished()?.topics.map((t) => [t.labelEn, t.count])).toEqual([['No answer found', 205]]);
  });

  it('reports a given day and passes resend', async () => {
    const { repo, calls } = fakeMetrics();
    const { email } = fakeEmail();
    await runDailyReport(
      { metrics: repo, cluster: async () => null, email, logger, now: NOW },
      { ...settings, day: '2026-10-25', resend: true },
    );
    expect(calls.find((c) => c.fn === 'claim')?.args).toEqual(['2026-10-25', true]);
    expect(calls.find((c) => c.fn === 'questions')?.args.slice(0, 2)).toEqual([
      new Date('2026-10-24T22:00:00Z'),
      new Date('2026-10-25T23:00:00Z'),
    ]);
  });
});

describe('createReportClusterer', () => {
  it('falls back (null) when the Claude client cannot be created, e.g. no API key', async () => {
    const cluster = createReportClusterer(() => {
      throw new Error('missing ANTHROPIC_API_KEY');
    }, 'claude-haiku-5-5');
    expect(await cluster(['vraag'])).toBeNull();
  });
});
