import type { Config } from './config.ts';
import { type Sample, type Summary, summarise } from './stats.ts';
import { runConversation, type VisitorDeps } from './visitor.ts';

export type RunDeps = Pick<VisitorDeps, 'fetch' | 'now' | 'sleep'> & {
  /** Random source for visitor `index` (seeded per visitor for reproducible runs). */
  randomFor: (index: number) => () => number;
};

/** mulberry32: small, fast, good enough to pick questions reproducibly. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Start offset of visitor `index` when `visitors` starts are spread evenly over `rampUpMs`. */
export function startOffset(index: number, visitors: number, rampUpMs: number): number {
  return visitors <= 1 ? 0 : Math.round((index * rampUpMs) / visitors);
}

/**
 * Runs `config.visitors` simulated visitors in parallel and summarises every request.
 * Duration mode: visitors keep starting conversations until the deadline (running ones finish).
 */
export async function runLoadTest(config: Config, deps: RunDeps): Promise<Summary> {
  const samples: Sample[] = [];
  let started = 0;
  let completed = 0;
  let retryAfterWaits = 0;
  const t0 = deps.now();
  const deadline = config.mode.kind === 'duration' ? t0 + config.mode.durationMs : null;

  const visitor = async (index: number) => {
    await deps.sleep(startOffset(index, config.visitors, config.rampUpMs));
    const visitorDeps: VisitorDeps = {
      fetch: deps.fetch,
      now: deps.now,
      sleep: deps.sleep,
      random: deps.randomFor(index),
      record: (sample) => samples.push(sample),
      onRetryAfterWait: () => {
        retryAfterWaits += 1;
      },
    };
    for (let n = 0; ; n += 1) {
      if (deadline === null) {
        if (config.mode.kind === 'conversations' && n >= config.mode.perVisitor) return;
      } else if (deps.now() >= deadline) {
        return;
      }
      // Pause between conversations too, so a failing target is not hammered in a tight loop.
      if (n > 0) await deps.sleep(config.thinkTimeMs);
      if (deadline !== null && deps.now() >= deadline) return;
      started += 1;
      if (await runConversation(visitorDeps, config)) completed += 1;
    }
  };

  await Promise.all(Array.from({ length: config.visitors }, (_, i) => visitor(i)));
  return summarise({
    samples,
    wallTimeMs: deps.now() - t0,
    conversationsStarted: started,
    conversationsCompleted: completed,
    retryAfterWaits,
  });
}
