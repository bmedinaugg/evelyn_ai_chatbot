import { describe, expect, it } from 'vitest';
import { type Config, parseConfig } from '../src/config.ts';

function ok(argv: string[], env: Record<string, string> = {}): Config {
  const result = parseConfig(argv, env);
  if (result.ok !== true) throw new Error(`expected a config, got ${JSON.stringify(result)}`);
  return result.config;
}

function error(argv: string[], env: Record<string, string> = {}): string {
  const result = parseConfig(argv, env);
  if (result.ok !== false) throw new Error(`expected an error, got ${JSON.stringify(result)}`);
  return result.error;
}

const PREPROD = 'https://dons3qf04vw1f.cloudfront.net';

describe('parseConfig', () => {
  it('has safe local defaults', () => {
    expect(ok([])).toEqual({
      baseUrl: 'http://127.0.0.1:8787',
      visitors: 5,
      rampUpMs: 0,
      mode: { kind: 'conversations', perVisitor: 1 },
      minQuestions: 1,
      maxQuestions: 3,
      thinkTimeMs: 1000,
      timeoutMs: 60_000,
      respectRetryAfter: false,
      maxRetries: 2,
      origin: null,
      seed: null,
      json: false,
    });
  });

  it('reads flags, and flags win over the environment', () => {
    const config = ok(
      [
        '--visitors',
        '8',
        '--ramp-up',
        '2.5',
        '--duration',
        '30',
        '--respect-retry-after',
        '--json',
        '--base-url',
        'http://localhost:9000/',
      ],
      { LOADTEST_VISITORS: '3', LOADTEST_THINK_TIME_MS: '250', LOADTEST_SEED: '7' },
    );
    expect(config.visitors).toBe(8);
    expect(config.rampUpMs).toBe(2500);
    expect(config.mode).toEqual({ kind: 'duration', durationMs: 30_000 });
    expect(config.respectRetryAfter).toBe(true);
    expect(config.json).toBe(true);
    expect(config.thinkTimeMs).toBe(250);
    expect(config.seed).toBe(7);
    expect(config.baseUrl).toBe('http://localhost:9000');
  });

  it('reads booleans from the environment', () => {
    expect(ok([], { LOADTEST_RESPECT_RETRY_AFTER: 'true' }).respectRetryAfter).toBe(true);
    expect(ok([], { LOADTEST_RESPECT_RETRY_AFTER: '0' }).respectRetryAfter).toBe(false);
  });

  it('rejects invalid numbers and unknown flags', () => {
    expect(error(['--visitors', 'many'])).toContain('--visitors');
    expect(error(['--visitors', '0'])).toContain('--visitors');
    expect(error(['--timeout', '1.5'])).toContain('--timeout');
    expect(error(['--min-questions', '3', '--max-questions', '2'])).toContain('--min-questions');
    expect(error(['--max-questions', '21'])).toContain('--max-questions');
    expect(error(['--duration', '10', '--conversations', '2'])).toContain('cannot be combined');
    expect(error(['--frobnicate'])).toMatch(/frobnicate/);
    expect(error(['--base-url', 'not a url'])).toContain('--base-url');
    expect(error(['--base-url', 'ftp://localhost'])).toContain('http or https');
  });

  it('caps concurrency unless explicitly allowed', () => {
    expect(error(['--visitors', '51'])).toContain('--allow-high-concurrency');
    expect(ok(['--visitors', '51', '--allow-high-concurrency']).visitors).toBe(51);
    expect(error(['--visitors', '501', '--allow-high-concurrency'])).toContain('--visitors');
  });

  it('accepts loopback hosts without confirmation', () => {
    for (const url of ['http://localhost:8787', 'http://127.0.0.1:1', 'http://[::1]:8787']) {
      expect(ok(['--base-url', url]).baseUrl).toBe(url);
    }
  });

  it('refuses a remote host without LOADTEST_CONFIRM_TARGET', () => {
    expect(error(['--base-url', PREPROD])).toContain(
      'LOADTEST_CONFIRM_TARGET=dons3qf04vw1f.cloudfront.net',
    );
    expect(error([], { LOADTEST_BASE_URL: PREPROD })).toContain('Refusing');
  });

  it('refuses when the confirmation names a different host', () => {
    expect(
      error(['--base-url', PREPROD], { LOADTEST_CONFIRM_TARGET: 'other.cloudfront.net' }),
    ).toContain('Refusing');
    expect(
      error(['--base-url', `${PREPROD}:8443`], {
        LOADTEST_CONFIRM_TARGET: 'dons3qf04vw1f.cloudfront.net',
      }),
    ).toContain('Refusing');
    // Lookalike loopback names are not loopback.
    expect(error(['--base-url', 'http://localhost.evil.example'])).toContain('Refusing');
  });

  it('accepts a remote host with the exact confirmation, over https only', () => {
    const env = { LOADTEST_CONFIRM_TARGET: 'dons3qf04vw1f.cloudfront.net' };
    expect(ok(['--base-url', PREPROD], env).baseUrl).toBe(PREPROD);
    expect(error(['--base-url', 'http://dons3qf04vw1f.cloudfront.net'], env)).toContain('https');
  });

  it('normalises the origin header', () => {
    expect(ok(['--origin', 'https://www.support.trainmore.com/nl/']).origin).toBe(
      'https://www.support.trainmore.com',
    );
    expect(error(['--origin', 'nope'])).toContain('--origin');
  });

  it('answers --help', () => {
    expect(parseConfig(['--help'], {})).toEqual({ ok: 'help' });
  });
});
