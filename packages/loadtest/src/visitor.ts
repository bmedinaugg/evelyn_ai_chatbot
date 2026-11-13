import { z } from 'zod';
import type { Config } from './config.ts';
import { type Lang, QUESTIONS } from './questions.ts';
import type { ErrorKind, Sample, Step } from './stats.ts';

/** Longest Retry-After we honour; longer waits are capped (a load test should keep moving). */
export const MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

export type VisitorDeps = {
  fetch: typeof fetch;
  /** Monotonic milliseconds (performance.now in the CLI). */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Uniform in [0, 1). */
  random: () => number;
  record: (sample: Sample) => void;
  onRetryAfterWait: () => void;
};

export type VisitorConfig = Pick<
  Config,
  | 'baseUrl'
  | 'minQuestions'
  | 'maxQuestions'
  | 'thinkTimeMs'
  | 'timeoutMs'
  | 'respectRetryAfter'
  | 'maxRetries'
  | 'origin'
>;

// Response shapes from apps/api/src/server.ts (POST /widget/conversations and …/messages).
const createdSchema = z.object({ conversationId: z.string().min(1), token: z.string().min(1) });
const replySchema = z.object({
  reply: z.object({ text: z.string(), lang: z.enum(['nl', 'en']), action: z.string() }),
});

/** Seconds or an HTTP date, as in RFC 9110; capped at MAX_RETRY_AFTER_MS. */
export function parseRetryAfter(value: string | null, nowEpochMs: number): number {
  if (value === null || value.trim() === '') return DEFAULT_RETRY_AFTER_MS;
  const trimmed = value.trim();
  const ms = /^\d+$/.test(trimmed)
    ? Number(trimmed) * 1000
    : Number.isNaN(Date.parse(trimmed))
      ? DEFAULT_RETRY_AFTER_MS
      : Date.parse(trimmed) - nowEpochMs;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

export function classifyStatus(status: number): ErrorKind {
  if (status === 429) return 'rate_limited';
  if (status === 409) return 'busy';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'invalid_response';
}

function classifyThrown(error: unknown): ErrorKind {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    ? 'timeout'
    : 'network';
}

/** Fisher–Yates on a copy; picks `count` distinct questions. */
export function pickQuestions(lang: Lang, count: number, random: () => number): string[] {
  const pool = [...QUESTIONS[lang]];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as string, pool[i] as string];
  }
  // More questions than the pool holds: repeat it (only with --max-questions > pool size).
  return Array.from({ length: count }, (_, i) => pool[i % pool.length] as string);
}

/**
 * One request with optional 429 retries. Every attempt is recorded as its own sample, so the
 * report shows how often the rate limit was hit even when the retry succeeded.
 */
async function call<T>(
  deps: VisitorDeps,
  config: VisitorConfig,
  step: Step,
  path: string,
  body: unknown,
  token: string | null,
  expectedStatus: number,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (config.origin !== null) headers.origin = config.origin;

  for (let attempt = 0; ; attempt += 1) {
    const started = deps.now();
    let response: Response;
    let text: string;
    try {
      response = await deps.fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      // Read the body inside the timed section: the answer is only there once it is complete.
      text = await response.text();
    } catch (error) {
      deps.record({
        step,
        status: null,
        ok: false,
        latencyMs: deps.now() - started,
        error: classifyThrown(error),
      });
      return null;
    }
    const latencyMs = deps.now() - started;

    if (response.status === expectedStatus) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const parsed = schema.safeParse(json);
      deps.record({
        step,
        status: response.status,
        ok: parsed.success,
        latencyMs,
        ...(parsed.success ? {} : { error: 'invalid_response' as const }),
      });
      return parsed.success ? parsed.data : null;
    }

    deps.record({
      step,
      status: response.status,
      ok: false,
      latencyMs,
      error: classifyStatus(response.status),
    });
    if (response.status !== 429 || !config.respectRetryAfter || attempt >= config.maxRetries) {
      return null;
    }
    deps.onRetryAfterWait();
    await deps.sleep(parseRetryAfter(response.headers.get('retry-after'), Date.now()));
  }
}

/**
 * One widget conversation, as the widget does it after the visitor has given consent (consent is
 * client-side only; the API needs no consent call): create the conversation, then ask 1–3
 * questions, each waiting for its answer. Returns whether every step succeeded.
 */
export async function runConversation(deps: VisitorDeps, config: VisitorConfig): Promise<boolean> {
  const lang: Lang = deps.random() < 0.5 ? 'nl' : 'en';
  const created = await call(
    deps,
    config,
    'create',
    '/widget/conversations',
    { lang },
    null,
    201,
    createdSchema,
  );
  if (!created) return false;

  const span = config.maxQuestions - config.minQuestions + 1;
  const count = config.minQuestions + Math.floor(deps.random() * span);
  const questions = pickQuestions(lang, count, deps.random);
  const path = `/widget/conversations/${encodeURIComponent(created.conversationId)}/messages`;
  for (const [i, text] of questions.entries()) {
    // The visitor reads the answer before asking the next question.
    if (i > 0) await deps.sleep(config.thinkTimeMs);
    const reply = await call(
      deps,
      config,
      'message',
      path,
      { text, pageLang: lang },
      created.token,
      200,
      replySchema,
    );
    if (!reply) return false;
  }
  return true;
}
