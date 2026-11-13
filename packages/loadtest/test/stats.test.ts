import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/report.ts';
import {
  count5xx,
  percentile,
  type Sample,
  summarise,
  summariseLatency,
  summariseSteps,
} from '../src/stats.ts';

describe('percentile (nearest rank)', () => {
  const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it('returns null for no samples', () => {
    expect(percentile([], 50)).toBeNull();
  });

  it('picks the nearest-rank value', () => {
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile(oneToHundred, 90)).toBe(90);
    expect(percentile(oneToHundred, 99)).toBe(99);
    expect(percentile(oneToHundred, 100)).toBe(100);
    expect(percentile(oneToHundred, 0)).toBe(1);
  });

  it('rounds the rank up on small samples', () => {
    expect(percentile([10, 20, 30], 50)).toBe(20);
    expect(percentile([10, 20, 30], 90)).toBe(30);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });
});

describe('summaries', () => {
  it('sorts before taking percentiles and reports the max', () => {
    expect(summariseLatency([30, 10, 20])).toEqual({
      count: 3,
      p50: 20,
      p90: 30,
      p99: 30,
      max: 30,
    });
    expect(summariseLatency([])).toEqual({ count: 0, p50: null, p90: null, p99: null, max: null });
  });

  const samples: Sample[] = [
    { step: 'create', status: 201, ok: true, latencyMs: 5 },
    { step: 'create', status: 429, ok: false, latencyMs: 1, error: 'rate_limited' },
    { step: 'message', status: 200, ok: true, latencyMs: 100 },
    { step: 'message', status: 503, ok: false, latencyMs: 50, error: 'server_error' },
    { step: 'message', status: 500, ok: false, latencyMs: 40, error: 'server_error' },
    { step: 'message', status: null, ok: false, latencyMs: 60_000, error: 'timeout' },
  ];

  it('counts statuses, successes and error kinds', () => {
    const s = summariseSteps(samples);
    expect(s.requests).toBe(6);
    expect(s.successes).toBe(2);
    expect(s.statuses).toEqual({ '201': 1, '429': 1, '200': 1, '503': 1, '500': 1, none: 1 });
    expect(s.errors).toEqual({ rate_limited: 1, server_error: 2, timeout: 1 });
    expect(count5xx(s.statuses)).toBe(2);
  });

  it('splits per step and computes throughput', () => {
    const summary = summarise({
      samples,
      wallTimeMs: 2000,
      conversationsStarted: 2,
      conversationsCompleted: 0,
      retryAfterWaits: 1,
    });
    expect(summary.steps.create.requests).toBe(2);
    expect(summary.steps.message.requests).toBe(4);
    expect(summary.steps.message.latency.max).toBe(60_000);
    expect(summary.requestsPerSecond).toBe(3);
    expect(summary.total.requests).toBe(6);
  });

  it('formats a compact table with 429 and 5xx columns', () => {
    const summary = summarise({
      samples,
      wallTimeMs: 2000,
      conversationsStarted: 2,
      conversationsCompleted: 0,
      retryAfterWaits: 1,
    });
    const text = formatReport(summary, { baseUrl: 'http://127.0.0.1:8787', visitors: 2 });
    expect(text).toContain('2 visitors');
    expect(text).toMatch(/^create\s+2\s+1\s+1\s+0\s+1ms\s+5ms/m);
    expect(text).toMatch(/^message\s+4\s+1\s+0\s+2\s+/m);
    expect(text).toContain('60.0s');
    expect(text).toContain('Errors: server_error 2, rate_limited 1, timeout 1');
  });
});
