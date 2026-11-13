import { parseArgs } from 'node:util';
import { z } from 'zod';

/** Without --allow-high-concurrency more visitors than this are refused. */
export const MAX_SAFE_VISITORS = 50;
/** Hard ceiling, even with --allow-high-concurrency. */
export const MAX_VISITORS = 500;
/** The API allows at most 20 customer messages per conversation. */
export const MAX_QUESTIONS_PER_CONVERSATION = 20;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** CLI flag → environment variable. Flags win over the environment. */
const OPTIONS = {
  'base-url': { env: 'LOADTEST_BASE_URL', type: 'string' },
  visitors: { env: 'LOADTEST_VISITORS', type: 'string' },
  'ramp-up': { env: 'LOADTEST_RAMP_UP', type: 'string' },
  duration: { env: 'LOADTEST_DURATION', type: 'string' },
  conversations: { env: 'LOADTEST_CONVERSATIONS', type: 'string' },
  'min-questions': { env: 'LOADTEST_MIN_QUESTIONS', type: 'string' },
  'max-questions': { env: 'LOADTEST_MAX_QUESTIONS', type: 'string' },
  'think-time': { env: 'LOADTEST_THINK_TIME_MS', type: 'string' },
  timeout: { env: 'LOADTEST_TIMEOUT_MS', type: 'string' },
  'respect-retry-after': { env: 'LOADTEST_RESPECT_RETRY_AFTER', type: 'boolean' },
  'max-retries': { env: 'LOADTEST_MAX_RETRIES', type: 'string' },
  'allow-high-concurrency': { env: 'LOADTEST_ALLOW_HIGH_CONCURRENCY', type: 'boolean' },
  origin: { env: 'LOADTEST_ORIGIN', type: 'string' },
  seed: { env: 'LOADTEST_SEED', type: 'string' },
  json: { env: 'LOADTEST_JSON', type: 'boolean' },
} as const;
type OptionName = keyof typeof OPTIONS;

export const USAGE = `Usage: pnpm --filter @trainmore/loadtest loadtest [options]

  --base-url <url>          API base URL (default http://127.0.0.1:8787)
  --visitors <n>            concurrent simulated visitors (default 5, max ${MAX_SAFE_VISITORS})
  --ramp-up <s>             spread visitor starts over this many seconds (default 0)
  --duration <s>            keep starting conversations for this long, or
  --conversations <n>       conversations per visitor (default 1; not with --duration)
  --min-questions <n>       questions per conversation, lower bound (default 1)
  --max-questions <n>       questions per conversation, upper bound (default 3)
  --think-time <ms>         pause between a visitor's requests (default 1000)
  --timeout <ms>            per-request timeout (default 60000)
  --respect-retry-after     on 429, wait for Retry-After and retry (see --max-retries)
  --max-retries <n>         retries per request after a 429 (default 2)
  --allow-high-concurrency  permit more than ${MAX_SAFE_VISITORS} visitors (up to ${MAX_VISITORS})
  --origin <origin>         send this Origin header (must be on the API's allowlist)
  --seed <n>                fixed seed for question choice (reproducible runs)
  --json                    print the summary as JSON

Every flag can also be set as an environment variable (LOADTEST_VISITORS=10 and so on).
A non-localhost base URL is refused unless LOADTEST_CONFIRM_TARGET is that exact host.`;

const TRUE_WORDS = new Set(['1', 'true', 'yes']);

const numberFrom = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)));
const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : Number(v)));

const rawSchema = z.object({
  'base-url': z.string().default('http://127.0.0.1:8787'),
  visitors: numberFrom(5).pipe(z.number().int().min(1).max(MAX_VISITORS)),
  'ramp-up': numberFrom(0).pipe(z.number().min(0).max(3600)),
  duration: optionalNumber.pipe(
    z
      .number()
      .positive()
      .max(24 * 3600)
      .optional(),
  ),
  conversations: optionalNumber.pipe(z.number().int().min(1).max(1000).optional()),
  'min-questions': numberFrom(1).pipe(z.number().int().min(1).max(MAX_QUESTIONS_PER_CONVERSATION)),
  'max-questions': numberFrom(3).pipe(z.number().int().min(1).max(MAX_QUESTIONS_PER_CONVERSATION)),
  'think-time': numberFrom(1000).pipe(z.number().int().min(0).max(600_000)),
  timeout: numberFrom(60_000).pipe(z.number().int().min(100).max(600_000)),
  'respect-retry-after': z.boolean(),
  'max-retries': numberFrom(2).pipe(z.number().int().min(0).max(10)),
  'allow-high-concurrency': z.boolean(),
  origin: z.url().optional(),
  seed: optionalNumber.pipe(z.number().int().min(0).optional()),
  json: z.boolean(),
});

export type Config = {
  baseUrl: string;
  visitors: number;
  rampUpMs: number;
  /** Either a time budget or a fixed number of conversations per visitor. */
  mode: { kind: 'duration'; durationMs: number } | { kind: 'conversations'; perVisitor: number };
  minQuestions: number;
  maxQuestions: number;
  thinkTimeMs: number;
  timeoutMs: number;
  respectRetryAfter: boolean;
  maxRetries: number;
  origin: string | null;
  seed: number | null;
  json: boolean;
};

export type ConfigResult = { ok: true; config: Config } | { ok: false; error: string };

/** True for loopback hosts only; everything else needs an explicit confirmation. */
export function isLocalHost(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname);
}

function readOptions(argv: readonly string[], env: Record<string, string | undefined>) {
  const parsed = parseArgs({
    args: [...argv],
    options: {
      ...Object.fromEntries(
        Object.entries(OPTIONS).map(([name, o]) => [name, { type: o.type }] as const),
      ),
      help: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  });
  // Flag names come from OPTIONS, so the parsed values are strings or booleans keyed by them.
  const values: Record<string, string | boolean | (string | boolean)[] | undefined> = parsed.values;
  const merged: Record<string, string | boolean | undefined> = {};
  for (const [name, option] of Object.entries(OPTIONS) as [
    OptionName,
    (typeof OPTIONS)[OptionName],
  ][]) {
    const flag = values[name];
    const fromEnv = env[option.env];
    if (option.type === 'boolean') {
      merged[name] =
        flag === true || (fromEnv !== undefined && TRUE_WORDS.has(fromEnv.trim().toLowerCase()));
    } else {
      merged[name] = typeof flag === 'string' ? flag : fromEnv;
    }
  }
  return { merged, help: values.help === true };
}

/** Parses flags and LOADTEST_* variables and applies the safety rules. Never throws. */
export function parseConfig(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): ConfigResult | { ok: 'help' } {
  let options: ReturnType<typeof readOptions>;
  try {
    options = readOptions(argv, env);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid arguments' };
  }
  if (options.help) return { ok: 'help' };

  const parsed = rawSchema.safeParse(options.merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `--${i.path.join('.')}: ${i.message}`);
    return { ok: false, error: issues.join('\n') };
  }
  const raw = parsed.data;

  let url: URL;
  try {
    url = new URL(raw['base-url']);
  } catch {
    return { ok: false, error: '--base-url: not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: '--base-url: must be http or https' };
  }
  if (!isLocalHost(url)) {
    const confirmed = env.LOADTEST_CONFIRM_TARGET?.trim();
    if (confirmed !== url.host) {
      return {
        ok: false,
        error:
          `Refusing to load-test ${url.host}: it is not localhost. Every answered question is a ` +
          `paid Claude call and the API rate-limits per IP. Set LOADTEST_CONFIRM_TARGET=${url.host} ` +
          'to confirm this exact host.',
      };
    }
    if (url.protocol !== 'https:') {
      return { ok: false, error: '--base-url: a remote target must use https' };
    }
  }

  if (raw.visitors > MAX_SAFE_VISITORS && !raw['allow-high-concurrency']) {
    return {
      ok: false,
      error: `--visitors: more than ${MAX_SAFE_VISITORS} needs --allow-high-concurrency`,
    };
  }
  if (raw['min-questions'] > raw['max-questions']) {
    return { ok: false, error: '--min-questions: must not exceed --max-questions' };
  }
  if (raw.duration !== undefined && raw.conversations !== undefined) {
    return { ok: false, error: '--duration and --conversations cannot be combined' };
  }

  return {
    ok: true,
    config: {
      baseUrl: url.origin + url.pathname.replace(/\/+$/, ''),
      visitors: raw.visitors,
      rampUpMs: Math.round(raw['ramp-up'] * 1000),
      mode:
        raw.duration === undefined
          ? { kind: 'conversations', perVisitor: raw.conversations ?? 1 }
          : { kind: 'duration', durationMs: Math.round(raw.duration * 1000) },
      minQuestions: raw['min-questions'],
      maxQuestions: raw['max-questions'],
      thinkTimeMs: raw['think-time'],
      timeoutMs: raw.timeout,
      respectRetryAfter: raw['respect-retry-after'],
      maxRetries: raw['max-retries'],
      origin: raw.origin === undefined ? null : new URL(raw.origin).origin,
      seed: raw.seed ?? null,
      json: raw.json,
    },
  };
}
