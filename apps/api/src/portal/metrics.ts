import { type DailyMetrics, MAX_METRICS_DAYS } from '@trainmore/db';
import { amsterdamDay, isDay, shiftDay } from '@trainmore/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type PortalDeps, requireAgent } from './auth.ts';

const day = z.string().refine(isDay);
const metricsQuery = z
  .object({ from: day.optional(), to: day.optional() })
  .transform((q) => {
    const to = q.to ?? amsterdamDay(new Date());
    return { from: q.from ?? shiftDay(to, -6), to };
  })
  .refine(
    ({ from, to }) =>
      from <= to &&
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
        86_400_000 <
        MAX_METRICS_DAYS,
  );

type Totals = Omit<DailyMetrics, 'day'>;

function totals(days: DailyMetrics[]): Totals {
  const sum: Totals = {
    conversations: 0,
    resolved: 0,
    escalations: 0,
    thumbsUp: 0,
    thumbsDown: 0,
    approvedAnswers: 0,
    logins: 0,
    flags: {},
  };
  for (const d of days) {
    sum.conversations += d.conversations;
    sum.resolved += d.resolved;
    sum.escalations += d.escalations;
    sum.thumbsUp += d.thumbsUp;
    sum.thumbsDown += d.thumbsDown;
    sum.approvedAnswers += d.approvedAnswers;
    sum.logins += d.logins;
    for (const [reason, n] of Object.entries(d.flags) as [keyof Totals['flags'], number][]) {
      sum.flags[reason] = (sum.flags[reason] ?? 0) + n;
    }
  }
  return sum;
}

/** Metrics per Amsterdam day (any portal role) and the topics of a sent daily report. */
export function registerPortalMetricsRoutes(app: FastifyInstance, deps: PortalDeps): void {
  app.get('/portal/api/metrics', async (request, reply) => {
    const agent = await requireAgent(deps, request, reply);
    if (!agent) return reply;
    const query = metricsQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request' });
    const days = await deps.metrics.dailyMetrics(query.data.from, query.data.to);
    return { from: query.data.from, to: query.data.to, days, totals: totals(days) };
  });

  app.get<{ Params: { day: string } }>('/portal/api/reports/:day', async (request, reply) => {
    const agent = await requireAgent(deps, request, reply);
    if (!agent) return reply;
    if (!isDay(request.params.day)) return reply.code(400).send({ error: 'invalid_request' });
    const report = await deps.metrics.getReport(request.params.day);
    if (!report) return reply.code(404).send({ error: 'not_found' });
    return report;
  });
}
