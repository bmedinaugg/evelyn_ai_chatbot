import { describe, expect, it } from 'vitest';
import { createTestApi, ORIGIN } from './helpers.ts';

type Api = ReturnType<typeof createTestApi>;

async function start(api: Api) {
  const res = await api.app.inject({
    method: 'POST',
    url: '/widget/conversations',
    headers: { origin: ORIGIN },
    payload: { lang: 'nl' },
  });
  return res.json() as { conversationId: string; token: string };
}

function call(
  api: Api,
  conv: { conversationId: string; token: string },
  path: string,
  payload: Record<string, unknown>,
) {
  return api.app.inject({
    method: 'POST',
    url: `/widget/conversations/${conv.conversationId}/login/${path}`,
    headers: { origin: ORIGIN, authorization: `Bearer ${conv.token}` },
    payload,
  });
}

const request = (
  api: Api,
  conv: { conversationId: string; token: string },
  email = 'lead@example.com',
) => call(api, conv, 'request', { email, lang: 'nl', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' });

describe('login', () => {
  it('requests a code: 202 regardless of the account, code emailed', async () => {
    const api = createTestApi();
    const conv = await start(api);
    const res = await request(api, conv);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(api.sentCodes).toEqual([
      { to: 'lead@example.com', code: expect.stringMatching(/^\d{6}$/) },
    ]);
  });

  it('needs Turnstile, a valid email and the conversation token', async () => {
    const failing = createTestApi({ turnstileOk: false });
    const conv = await start(failing);
    expect((await request(failing, conv)).json()).toEqual({ error: 'verification_failed' });
    expect(failing.sentCodes).toHaveLength(0);

    const api = createTestApi();
    const conv2 = await start(api);
    expect((await request(api, conv2, 'nope')).statusCode).toBe(400);
    expect(
      (
        await call(api, { ...conv2, token: 'x'.repeat(43) }, 'request', {
          email: 'a@example.com',
          lang: 'nl',
          turnstileToken: 't',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('verifies the code and binds the single account', async () => {
    const api = createTestApi();
    const conv = await start(api);
    await request(api, conv);
    const res = await call(api, conv, 'verify', {
      email: 'lead@example.com',
      code: api.sentCodes[0]?.code,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accounts: [{ index: 0, studioName: 'Club 1001', status: 'MEMBER', maskedNumber: '•••004' }],
      selected: 0,
    });
    expect((await api.authState(conv.conversationId)).account).toEqual({
      customerId: 4,
      studioId: 1001,
      status: 'MEMBER',
    });
  });

  it('rejects a wrong code and locks after too many attempts', async () => {
    const api = createTestApi();
    const conv = await start(api);
    await request(api, conv);
    const wrong = () => call(api, conv, 'verify', { email: 'lead@example.com', code: '000000' });
    for (let i = 0; i < 4; i += 1)
      expect((await wrong()).json()).toEqual({ error: 'invalid_code' });
    expect((await wrong()).json()).toEqual({ error: 'locked' });
    const right = await call(api, conv, 'verify', {
      email: 'lead@example.com',
      code: api.sentCodes[0]?.code,
    });
    expect(right.json()).toEqual({ error: 'locked' });
  });

  it('a code cannot log in another conversation', async () => {
    const api = createTestApi();
    const a = await start(api);
    const b = await start(api);
    await request(api, a);
    const res = await call(api, b, 'verify', {
      email: 'lead@example.com',
      code: api.sentCodes[0]?.code,
    });
    expect(res.json()).toEqual({ error: 'expired' });
  });

  it('lets the visitor pick among several accounts, by index only', async () => {
    const api = createTestApi({
      accounts: [
        { customerId: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' },
        { customerId: 5, studioId: 1002, status: 'FORMER_MEMBER', customerNumber: 'M-0005' },
      ],
    });
    const conv = await start(api);
    await request(api, conv);
    const verified = await call(api, conv, 'verify', {
      email: 'lead@example.com',
      code: api.sentCodes[0]?.code,
    });
    expect(verified.json()).toMatchObject({ selected: null });
    expect((await call(api, conv, 'select', { index: 9 })).statusCode).toBe(400);
    expect((await call(api, conv, 'select', { index: 1, customerId: 4 })).json()).toEqual({
      account: {
        index: 1,
        studioName: 'Club 1002',
        status: 'FORMER_MEMBER',
        maskedNumber: '•••005',
      },
    });
    expect((await api.authState(conv.conversationId)).account?.customerId).toBe(5);
  });

  it('selecting before verification is refused', async () => {
    const api = createTestApi();
    const conv = await start(api);
    expect((await call(api, conv, 'select', { index: 0 })).statusCode).toBe(400);
  });

  it('reports a Magicline outage and allows a retry', async () => {
    const api = createTestApi({ magiclineDown: true });
    const conv = await start(api);
    await request(api, conv);
    const res = await call(api, conv, 'verify', {
      email: 'lead@example.com',
      code: api.sentCodes[0]?.code,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'lookup_failed' });
    expect((await call(api, conv, 'lookup', { email: 'other@example.com' })).json()).toEqual({
      error: 'expired',
    });
  });

  it('never logs the email address or the code', async () => {
    const api = createTestApi();
    const conv = await start(api);
    await request(api, conv);
    await call(api, conv, 'verify', { email: 'lead@example.com', code: api.sentCodes[0]?.code });
    expect(api.logs()).not.toMatch(/lead@example\.com/);
    expect(api.logs()).not.toContain(api.sentCodes[0]?.code ?? 'none');
  });
});

describe('account questions', () => {
  it('anonymous visitors are asked to log in', async () => {
    const api = createTestApi({
      answer: {
        kind: 'answer',
        answer: {
          language: 'nl',
          intent: 'account_question',
          answer: 'x',
          citedArticleIds: [],
          confidence: 'high',
          needsHuman: false,
        },
        assistantContent: [],
      },
    });
    const conv = await start(api);
    const res = await api.app.inject({
      method: 'POST',
      url: `/widget/conversations/${conv.conversationId}/messages`,
      headers: { origin: ORIGIN, authorization: `Bearer ${conv.token}` },
      payload: { text: 'Wanneer eindigt mijn contract?', pageLang: 'nl' },
    });
    expect(res.json().reply).toMatchObject({ action: 'login' });
  });
});
