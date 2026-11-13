/** One HTTP request made by a simulated visitor. */
export type Step = 'create' | 'message';

export type ErrorKind =
  | 'rate_limited'
  | 'busy'
  | 'client_error'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'invalid_response';

export type Sample = {
  step: Step;
  /** HTTP status, or null when no response arrived (timeout, network). */
  status: number | null;
  ok: boolean;
  latencyMs: number;
  error?: ErrorKind;
};

export type LatencySummary = {
  count: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
};

export type StepSummary = {
  requests: number;
  successes: number;
  statuses: Record<string, number>;
  errors: Partial<Record<ErrorKind, number>>;
  /** Latency of every request that got a response or timed out (successes and failures). */
  latency: LatencySummary;
};

export type Summary = {
  wallTimeMs: number;
  requestsPerSecond: number;
  conversations: { started: number; completed: number };
  retryAfterWaits: number;
  total: StepSummary;
  steps: Record<Step, StepSummary>;
};

/**
 * Nearest-rank percentile: the smallest value with at least p% of the samples at or below it.
 * Returns null for an empty list.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (p <= 0) return sorted[0] ?? null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

export function summariseLatency(values: readonly number[]): LatencySummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? null,
  };
}

/** `none` counts requests without a response (timeouts, network errors). */
export function statusKey(status: number | null): string {
  return status === null ? 'none' : String(status);
}

export function summariseSteps(samples: readonly Sample[]): StepSummary {
  const statuses: Record<string, number> = {};
  const errors: Partial<Record<ErrorKind, number>> = {};
  for (const s of samples) {
    const key = statusKey(s.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
    if (s.error) errors[s.error] = (errors[s.error] ?? 0) + 1;
  }
  return {
    requests: samples.length,
    successes: samples.filter((s) => s.ok).length,
    statuses,
    errors,
    latency: summariseLatency(samples.map((s) => s.latencyMs)),
  };
}

export function summarise(input: {
  samples: readonly Sample[];
  wallTimeMs: number;
  conversationsStarted: number;
  conversationsCompleted: number;
  retryAfterWaits: number;
}): Summary {
  const { samples, wallTimeMs } = input;
  return {
    wallTimeMs,
    requestsPerSecond: wallTimeMs > 0 ? samples.length / (wallTimeMs / 1000) : 0,
    conversations: {
      started: input.conversationsStarted,
      completed: input.conversationsCompleted,
    },
    retryAfterWaits: input.retryAfterWaits,
    total: summariseSteps(samples),
    steps: {
      create: summariseSteps(samples.filter((s) => s.step === 'create')),
      message: summariseSteps(samples.filter((s) => s.step === 'message')),
    },
  };
}

/** Status codes in the 5xx range, summed. */
export function count5xx(statuses: Record<string, number>): number {
  return Object.entries(statuses)
    .filter(([code]) => /^5\d\d$/.test(code))
    .reduce((sum, [, n]) => sum + n, 0);
}
