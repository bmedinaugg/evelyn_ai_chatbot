import { describe, expect, it } from 'vitest';
import { createTestApi, ORIGIN } from './helpers.ts';

type Api = ReturnType<typeof createTestApi>;
type Conv = { conversationId: string; token: string };

async function start(api: Api): Promise<Conv> {
  const res = await api.app.inject({
    method: 'POST',
    url: '/widget/conversations',
    headers: { origin: ORIGIN },
    payload: { lang: 'nl' },
  });
  return res.json() as Conv;
}

async function ask(api: Api, conv: Conv): Promise<number> {
  const res = await api.app.inject({
    method: 'POST',
    url: `/widget/conversations/${conv.conversationId}/messages`,
    headers: { origin: ORIGIN, authorization: `Bearer ${conv.token}` },
    payload: { text: 'Vraag', pageLang: 'nl' },
  });
  return res.json().reply.messageId as number;
}

function rate(api: Api, conv: Conv, payload: Record<string, unknown>, token = conv.token) {
  return api.app.inject({
    method: 'POST',
    url: `/widget/conversations/${conv.conversationId}/feedback`,
    headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload,
  });
}

describe('POST /widget/conversations/:id/feedback', () => {
  it('rates a reply of the conversation', async () => {
    const api = createTestApi();
    const conv = await start(api);
    const messageId = await ask(api, conv);
    const res = await rate(api, conv, { messageId, rating: 'down' });
    expect(res.statusCode).toBe(204);
    expect(api.feedback).toEqual([
      { conversationId: conv.conversationId, messageId, rating: 'down' },
    ]);
  });

  it('rejects a reply of another conversation with 404', async () => {
    const api = createTestApi();
    const mine = await start(api);
    const other = await start(api);
    const othersReply = await ask(api, other);
    expect((await rate(api, mine, { messageId: othersReply, rating: 'up' })).statusCode).toBe(404);
    expect(api.feedback).toEqual([]);
  });

  it('needs the conversation token and a valid rating', async () => {
    const api = createTestApi();
    const conv = await start(api);
    const messageId = await ask(api, conv);
    expect((await rate(api, conv, { messageId, rating: 'up' }, '')).statusCode).toBe(401);
    expect((await rate(api, conv, { messageId, rating: 'up' }, 'x'.repeat(43))).statusCode).toBe(
      404,
    );
    expect((await rate(api, conv, { messageId, rating: 'meh' })).statusCode).toBe(400);
    expect((await rate(api, conv, { messageId: -1, rating: 'up' })).statusCode).toBe(400);
    expect(api.feedback).toEqual([]);
  });
});
