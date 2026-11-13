import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.ts';
import { QUESTIONS } from '../src/questions.ts';
import { runLoadTest, seededRandom, startOffset } from '../src/run.ts';
import type { Sample } from '../src/stats.ts';
import {
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  pickQuestions,
  runConversation,
  type VisitorConfig,
  type VisitorDeps,
} from '../src/visitor.ts';

const BASE = 'http://127.0.0.1:8787';
const TOKEN = 'a'.repeat(43);
const CONVERSATION = '00000000-0000-4000-8000-000000000001';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

const visitorConfig: VisitorConfig = {
  baseUrl: BASE,
  minQuestions: 2,
  maxQuestions: 2,
  thinkTimeMs: 500,
  timeoutMs: 5000,
  respectRetryAfter: false,
  maxRetries: 2,
  origin: null,
};

/** Fake API: responses are queued per call; the clock advances 10 ms per request. */
function fakeApi(responses: (() => Response)[] = []) {
  let clock = 0;
  const calls: Call[] = [];
  const samples: Sample[] = [];
  const sleeps: number[] = [];
  let waits = 0;
  const deps: VisitorDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: { ...(init?.headers as Record<string, string>) },
        body: JSON.parse(String(init?.body)),
      });
      clock += 10;
      const next = responses.shift();
      if (next) return next();
      return String(input).endsWith('/widget/conversations')
        ? Response.json({ conversationId: CONVERSATION, token: TOKEN }, { status: 201 })
        : Response.json({
            reply: { text: 'answer', lang: 'en', citations: [], action: 'none', messageId: 1 },
          });
    }) as typeof fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: seededRandom(1),
    record: (s) => samples.push(s),
    onRetryAfterWait: () => {
      waits += 1;
    },
  };
  return { deps, calls, samples, sleeps, waits: () => waits };
}

describe('runConversation (stubbed fetch)', () => {
  it('follows the widget flow: create, then each question with the bearer token', async () => {
    const api = fakeApi();
    expect(await runConversation(api.deps, visitorConfig)).toBe(true);

    expect(api.calls).toHaveLength(3);
    const [create, first, second] = api.calls;
    expect(create?.url).toBe(`${BASE}/widget/conversations`);
    expect(create?.method).toBe('POST');
    expect(create?.headers.authorization).toBeUndefined();
    const lang = (create?.body as { lang: 'nl' | 'en' } | undefined)?.lang ?? 'nl';
    expect(['nl', 'en']).toContain(lang);

    for (const call of [first, second]) {
      expect(call?.url).toBe(`${BASE}/widget/conversations/${CONVERSATION}/messages`);
      expect(call?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call?.headers['content-type']).toBe('application/json');
      const body = call?.body as { text: string; pageLang: string };
      expect(body.pageLang).toBe(lang);
      expect(QUESTIONS[lang]).toContain(body.text);
    }
    expect(first?.body).not.toEqual(second?.body);
    // Think time only between questions, not before the first.
    expect(api.sleeps).toEqual([500]);
    expect(api.samples.map((s) => [s.step, s.status, s.ok, s.latencyMs])).toEqual([
      ['create', 201, true, 10],
      ['message', 200, true, 10],
      ['message', 200, true, 10],
    ]);
  });

  it('sends the Origin header when configured', async () => {
    const api = fakeApi();
    await runConversation(api.deps, { ...visitorConfig, origin: 'https://www.example.com' });
    expect(api.calls.every((c) => c.headers.origin === 'https://www.example.com')).toBe(true);
  });

  it('stops the conversation when creating it is rate limited', async () => {
    const api = fakeApi([() => Response.json({ error: 'rate_limited' }, { status: 429 })]);
    expect(await runConversation(api.deps, visitorConfig)).toBe(false);
    expect(api.calls).toHaveLength(1);
    expect(api.samples).toEqual([
      { step: 'create', status: 429, ok: false, latencyMs: 10, error: 'rate_limited' },
    ]);
  });

  it('waits for Retry-After and retries when asked to', async () => {
    const api = fakeApi([
      () =>
        Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '7' } }),
    ]);
    const done = await runConversation(api.deps, { ...visitorConfig, respectRetryAfter: true });
    expect(done).toBe(true);
    expect(api.sleeps[0]).toBe(7000);
    expect(api.waits()).toBe(1);
    expect(api.samples.map((s) => s.status)).toEqual([429, 201, 200, 200]);
  });

  it('gives up after maxRetries 429s', async () => {
    const limited = () => Response.json({ error: 'rate_limited' }, { status: 429 });
    const api = fakeApi([limited, limited, limited, limited]);
    const done = await runConversation(api.deps, {
      ...visitorConfig,
      respectRetryAfter: true,
      maxRetries: 2,
    });
    expect(done).toBe(false);
    expect(api.calls).toHaveLength(3);
    expect(api.waits()).toBe(2);
  });

  it('classifies busy, server errors, bad bodies, timeouts and network errors', async () => {
    const cases: [() => Response, string][] = [
      [() => Response.json({ error: 'busy' }, { status: 409 }), 'busy'],
      [() => Response.json({ error: 'internal' }, { status: 500 }), 'server_error'],
      [() => Response.json({ unexpected: true }, { status: 200 }), 'invalid_response'],
      [() => new Response('not json', { status: 200 }), 'invalid_response'],
      [() => Response.json({ error: 'not_found' }, { status: 404 }), 'client_error'],
    ];
    const created = () =>
      Response.json({ conversationId: CONVERSATION, token: TOKEN }, { status: 201 });
    for (const [response, kind] of cases) {
      const api = fakeApi([created, response]);
      expect(await runConversation(api.deps, visitorConfig)).toBe(false);
      expect(api.samples.at(-1)?.error).toBe(kind);
    }

    const timeout = fakeApi();
    timeout.deps.fetch = (async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as typeof fetch;
    await runConversation(timeout.deps, visitorConfig);
    expect(timeout.samples).toEqual([
      { step: 'create', status: null, ok: false, latencyMs: 0, error: 'timeout' },
    ]);

    const network = fakeApi();
    network.deps.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await runConversation(network.deps, visitorConfig);
    expect(network.samples[0]?.error).toBe('network');
  });
});

describe('helpers', () => {
  it('parses Retry-After seconds and dates, with a cap', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
    expect(parseRetryAfter(null, 0)).toBe(1000);
    expect(parseRetryAfter('soon', 0)).toBe(1000);
    expect(parseRetryAfter('3600', 0)).toBe(MAX_RETRY_AFTER_MS);
    const now = Date.parse('2026-11-13T10:00:00Z');
    expect(parseRetryAfter('Fri, 13 Nov 2026 10:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter('Fri, 13 Nov 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('picks distinct questions in one language', () => {
    const picked = pickQuestions('nl', 3, seededRandom(42));
    expect(new Set(picked).size).toBe(3);
    for (const q of picked) expect(QUESTIONS.nl).toContain(q);
    expect(pickQuestions('nl', 3, seededRandom(42))).toEqual(picked);
  });

  it('spreads visitor starts over the ramp-up', () => {
    expect([0, 1, 2, 3].map((i) => startOffset(i, 4, 1000))).toEqual([0, 250, 500, 750]);
    expect(startOffset(0, 1, 1000)).toBe(0);
  });
});

const baseConfig: Config = {
  ...visitorConfig,
  visitors: 3,
  rampUpMs: 0,
  mode: { kind: 'conversations', perVisitor: 2 },
  minQuestions: 1,
  maxQuestions: 3,
  seed: 1,
  json: false,
};

describe('runLoadTest (stubbed fetch)', () => {
  it('runs every visitor the configured number of conversations', async () => {
    const api = fakeApi();
    const summary = await runLoadTest(baseConfig, {
      fetch: api.deps.fetch,
      now: api.deps.now,
      sleep: api.deps.sleep,
      randomFor: (i) => seededRandom(i),
    });
    expect(summary.conversations).toEqual({ started: 6, completed: 6 });
    expect(summary.steps.create.requests).toBe(6);
    expect(summary.steps.message.requests).toBeGreaterThanOrEqual(6);
    expect(summary.steps.message.requests).toBeLessThanOrEqual(18);
    expect(summary.total.successes).toBe(summary.total.requests);
  });

  it('stops starting conversations at the deadline in duration mode', async () => {
    const api = fakeApi();
    const summary = await runLoadTest(
      { ...baseConfig, visitors: 1, mode: { kind: 'duration', durationMs: 2000 } },
      {
        fetch: api.deps.fetch,
        now: api.deps.now,
        sleep: api.deps.sleep,
        randomFor: () => seededRandom(3),
      },
    );
    // Each conversation takes at least 10 ms + a 500 ms pause before the next one.
    expect(summary.conversations.started).toBeGreaterThan(1);
    expect(summary.conversations.started).toBeLessThanOrEqual(4);
    expect(summary.conversations.completed).toBe(summary.conversations.started);
  });
});

describe('runLoadTest against a local HTTP stub', () => {
  let server: Server | undefined;
  afterEach(
    () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  );

  async function readBody(request: IncomingMessage): Promise<unknown> {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    return JSON.parse(raw);
  }

  it('drives real HTTP requests and counts 429s', async () => {
    let creates = 0;
    const seen: { path: string; auth: string | undefined; body: unknown }[] = [];
    server = createServer(async (request, response) => {
      const body = await readBody(request);
      seen.push({ path: request.url ?? '', auth: request.headers.authorization, body });
      response.setHeader('content-type', 'application/json');
      if (request.url === '/widget/conversations') {
        creates += 1;
        // Like the API's per-IP limit: the third conversation is refused.
        if (creates === 3) {
          response.statusCode = 429;
          response.setHeader('retry-after', '1');
          response.end(JSON.stringify({ error: 'rate_limited' }));
          return;
        }
        response.statusCode = 201;
        response.end(JSON.stringify({ conversationId: `c${creates}`, token: TOKEN }));
        return;
      }
      await sleep(5);
      response.end(
        JSON.stringify({ reply: { text: 'ok', lang: 'nl', citations: [], action: 'none' } }),
      );
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const summary = await runLoadTest(
      {
        ...baseConfig,
        baseUrl: `http://127.0.0.1:${port}`,
        visitors: 3,
        mode: { kind: 'conversations', perVisitor: 1 },
        minQuestions: 1,
        maxQuestions: 1,
        thinkTimeMs: 0,
      },
      {
        fetch: globalThis.fetch.bind(globalThis),
        now: () => performance.now(),
        sleep: (ms) => sleep(ms),
        randomFor: (i) => seededRandom(i),
      },
    );

    expect(summary.steps.create.statuses).toEqual({ '201': 2, '429': 1 });
    expect(summary.steps.create.errors).toEqual({ rate_limited: 1 });
    expect(summary.steps.message.statuses).toEqual({ '200': 2 });
    expect(summary.conversations).toEqual({ started: 3, completed: 2 });
    expect(summary.steps.message.latency.p50).toBeGreaterThanOrEqual(4);
    const messages = seen.filter((s) => s.path.endsWith('/messages'));
    expect(messages.every((m) => m.auth === `Bearer ${TOKEN}`)).toBe(true);
  });
});
