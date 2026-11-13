import { count5xx, type StepSummary, type Summary } from './stats.ts';

function ms(value: number | null): string {
  if (value === null) return '-';
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function statuses(summary: StepSummary): string {
  const entries = Object.entries(summary.statuses).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([code, n]) => `${code}:${n}`).join(' ') : '-';
}

function row(cells: readonly string[], widths: readonly number[]): string {
  return cells
    .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
    .join('  ')
    .trimEnd();
}

/** Compact human-readable report (no tokens, ids or answer text: nothing personal). */
export function formatReport(summary: Summary, target: { baseUrl: string; visitors: number }) {
  const header = ['step', 'reqs', 'ok', '429', '5xx', 'p50', 'p90', 'p99', 'max', 'statuses'];
  const rows: [string, StepSummary][] = [
    ['create', summary.steps.create],
    ['message', summary.steps.message],
    ['total', summary.total],
  ];
  const lines = rows.map(([name, s]) => [
    name,
    String(s.requests),
    String(s.successes),
    String(s.statuses['429'] ?? 0),
    String(count5xx(s.statuses)),
    ms(s.latency.p50),
    ms(s.latency.p90),
    ms(s.latency.p99),
    ms(s.latency.max),
    statuses(s),
  ]);
  // The last column is left free so long status lists do not widen the table.
  const widths = header.map((h, i) =>
    i === header.length - 1 ? 0 : Math.max(h.length, ...lines.map((l) => (l[i] ?? '').length)),
  );
  const errors = Object.entries(summary.total.errors)
    .sort(([, a], [, b]) => b - a)
    .map(([kind, n]) => `${kind} ${n}`)
    .join(', ');

  return [
    `Load test: ${target.baseUrl}, ${target.visitors} visitors, ` +
      `${(summary.wallTimeMs / 1000).toFixed(1)} s, ${summary.requestsPerSecond.toFixed(2)} req/s`,
    `Conversations: ${summary.conversations.started} started, ` +
      `${summary.conversations.completed} completed; Retry-After waits: ${summary.retryAfterWaits}`,
    '',
    row(header, widths),
    ...lines.map((l) => row(l, widths)),
    '',
    `Errors: ${errors || 'none'}`,
  ].join('\n');
}
