import { describe, expect, it } from 'vitest';
import { CONTACT_URL, createTestApi, ORIGIN } from './helpers.ts';

async function start(api: ReturnType<typeof createTestApi>) {
  const res = await api.app.inject({
    method: 'POST',
    url: '/widget/conversations',
    headers: { origin: ORIGIN },
    payload: { lang: 'en' },
  });
  return { res, body: res.json() as { conversationId: string; token: string } };
}

function send(
  api: ReturnType<typeof createTestApi>,
  id: string,
  token: string | undefined,
  payload: unknown,
) {
  return api.app.inject({
    method: 'POST',
    url: `/widget/conversations/${id}/messages`,
    headers: {
      origin: ORIGIN,
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    payload: payload as Record<string, unknown>,
  });
}

describe('widget conversations', () => {
  it('health', async () => {
    const api = createTestApi();
    expect((await api.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
  });

  it('creates a conversation with a token and stores only its hash', async () => {
    const api = createTestApi();
    const { res, body } = await start(api);
    expect(res.statusCode).toBe(201);
    const stored = api.conversations.get(body.conversationId);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).not.toBe(body.token);
  });

  it('answers a message and adds the contact URL for hand-offs', async () => {
    const api = createTestApi();
    const { body } = await start(api);
    const res = await send(api, body.conversationId, body.token, {
      text: 'I want a person',
      pageLang: 'en',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: {
        text: 'Of course. Fill in the form below and our support team will get back to you by email.',
        lang: 'en',
        citations: [],
        action: 'ticket_form',
        contactUrl: CONTACT_URL,
      },
    });
  });

  it('omits the contact URL when no hand-off is needed', async () => {
    const api = createTestApi({
      answer: {
        kind: 'answer',
        answer: {
          language: 'en',
          intent: 'greeting',
          answer: 'Hi!',
          citedArticleIds: [],
          confidence: 'high',
          needsHuman: false,
        },
        assistantContent: [],
        steps: [],
        toolsUsed: [],
      },
    });
    const { body } = await start(api);
    const res = await send(api, body.conversationId, body.token, { text: 'hello', pageLang: 'en' });
    expect(res.json().reply).toEqual({
      text: 'Hi! How can I help you today?',
      lang: 'en',
      citations: [],
      action: 'none',
    });
  });

  it('rejects a wrong token or another conversation’s token with 404, without calling Claude', async () => {
    const api = createTestApi();
    const a = await start(api);
    const b = await start(api);
    expect(
      (await send(api, a.body.conversationId, 'x'.repeat(43), { text: 'hi', pageLang: 'en' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await send(api, b.body.conversationId, a.body.token, { text: 'hi', pageLang: 'en' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await send(api, 'not-a-uuid', a.body.token, { text: 'hi', pageLang: 'en' })).statusCode,
    ).toBe(404);
    expect(api.answererCalls).toHaveLength(0);
  });

  it('requires a bearer token', async () => {
    const api = createTestApi();
    const { body } = await start(api);
    expect(
      (await send(api, body.conversationId, undefined, { text: 'hi', pageLang: 'en' })).statusCode,
    ).toBe(401);
  });

  it('validates the message body', async () => {
    const api = createTestApi();
    const { body } = await start(api);
    const id = body.conversationId;
    expect((await send(api, id, body.token, { text: '   ', pageLang: 'en' })).statusCode).toBe(400);
    expect(
      (await send(api, id, body.token, { text: 'x'.repeat(1001), pageLang: 'en' })).statusCode,
    ).toBe(400);
    expect((await send(api, id, body.token, { text: 'hi', pageLang: 'de' })).statusCode).toBe(400);
    expect(
      (await send(api, id, body.token, { text: 'hi', pageLang: 'en', extra: 1 })).statusCode,
    ).toBe(200);
  });

  it('returns 409 while another turn is in flight', async () => {
    const api = createTestApi();
    const { body } = await start(api);
    const stored = api.conversations.get(body.conversationId);
    if (stored) stored.claimed = true;
    const res = await send(api, body.conversationId, body.token, { text: 'hi', pageLang: 'en' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'busy' });
  });

  it('blocks disallowed origins and sends CORS headers for allowed ones', async () => {
    const api = createTestApi();
    const blocked = await api.app.inject({
      method: 'POST',
      url: '/widget/conversations',
      headers: { origin: 'https://evil.example' },
      payload: { lang: 'en' },
    });
    expect(blocked.statusCode).toBe(403);
    const { res } = await start(api);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('rate-limits conversation creation per IP', async () => {
    const api = createTestApi();
    for (let i = 0; i < 10; i += 1) expect((await start(api)).res.statusCode).toBe(201);
    expect((await start(api)).res.statusCode).toBe(429);
  });

  it('behind CloudFront + ALB, rate limits and Turnstile use the visitor IP, not the proxy', async () => {
    const api = createTestApi({ trustProxyHops: 2 });
    const create = (visitor: string) =>
      api.app.inject({
        method: 'POST',
        url: '/widget/conversations',
        remoteAddress: '10.0.1.20',
        headers: { origin: ORIGIN, 'x-forwarded-for': `${visitor}, 130.176.0.10` },
        payload: { lang: 'en' },
      });
    for (let i = 0; i < 10; i += 1) expect((await create('203.0.113.5')).statusCode).toBe(201);
    expect((await create('203.0.113.5')).statusCode).toBe(429);
    expect((await create('198.51.100.7')).statusCode).toBe(201);

    await api.app.inject({
      method: 'POST',
      url: '/widget/leads',
      remoteAddress: '10.0.1.20',
      headers: { origin: ORIGIN, 'x-forwarded-for': '198.51.100.7, 130.176.0.10' },
      payload: {
        email: 'a@example.com',
        question: 'q',
        lang: 'en',
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
        consent: true,
      },
    });
    expect(api.turnstileIps).toEqual(['198.51.100.7']);
  });

  it('ignores X-Forwarded-For from a client connecting directly (no spoofing)', async () => {
    const api = createTestApi({ trustProxyHops: 2 });
    const create = (spoofed: string) =>
      api.app.inject({
        method: 'POST',
        url: '/widget/conversations',
        remoteAddress: '203.0.113.99',
        headers: { origin: ORIGIN, 'x-forwarded-for': `${spoofed}, 1.2.3.4` },
        payload: { lang: 'en' },
      });
    for (let i = 0; i < 10; i += 1) expect((await create(`198.51.100.${i}`)).statusCode).toBe(201);
    expect((await create('198.51.100.200')).statusCode).toBe(429);
  });

  it('hides internal errors', async () => {
    const api = createTestApi({ claimError: new TypeError('db exploded at secret.ts:12') });
    const { body } = await start(api);
    const res = await send(api, body.conversationId, body.token, { text: 'hi', pageLang: 'en' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal' });
  });
});
