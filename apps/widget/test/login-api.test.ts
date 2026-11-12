import { beforeEach, describe, expect, it } from 'vitest';
import { createWidgetApi, WidgetApiError } from '../src/lib/api.ts';

let requests: Request[];
let responses: Response[];
const fakeFetch: typeof fetch = async (input, init) => {
  requests.push(new Request(input, init));
  const next = responses.shift();
  if (!next) throw new Error('no response queued');
  return next;
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const api = createWidgetApi({ baseUrl: 'https://api.test', fetch: fakeFetch });
const session = { conversationId: '00000000-0000-4000-8000-000000000001', token: 't'.repeat(43) };
const base = `https://api.test/widget/conversations/${session.conversationId}/login`;

beforeEach(() => {
  requests = [];
  responses = [];
});

describe('login API', () => {
  it('requests a code', async () => {
    responses.push(json(202, { ok: true }));
    await api.requestLoginCode(session, 'a@example.com', 'nl', 'tok');
    expect(requests[0]?.url).toBe(`${base}/request`);
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${session.token}`);
    expect(await requests[0]?.json()).toEqual({
      email: 'a@example.com',
      lang: 'nl',
      turnstileToken: 'tok',
    });
  });

  it('verifies a code and returns the accounts', async () => {
    const accounts = [{ index: 0, studioName: 'Club A', status: 'MEMBER', maskedNumber: '•••004' }];
    responses.push(json(200, { accounts, selected: 0 }));
    expect(await api.verifyLoginCode(session, 'a@example.com', '123456')).toEqual({
      accounts,
      selected: 0,
    });
    expect(requests[0]?.url).toBe(`${base}/verify`);
  });

  it('selects an account by index', async () => {
    const account = {
      index: 1,
      studioName: 'Club B',
      status: 'FORMER_MEMBER',
      maskedNumber: '•••005',
    };
    responses.push(json(200, { account }));
    expect(await api.selectAccount(session, 1)).toEqual(account);
    expect(await requests[0]?.json()).toEqual({ index: 1 });
  });

  it('maps login errors', async () => {
    for (const [response, kind] of [
      [json(400, { error: 'invalid_code' }), 'invalid_code'],
      [json(400, { error: 'locked' }), 'locked'],
      [json(400, { error: 'expired' }), 'expired'],
      [json(503, { error: 'lookup_failed' }), 'lookup_failed'],
    ] as const) {
      responses.push(response);
      const error = await api.verifyLoginCode(session, 'a@example.com', '000000').catch((e) => e);
      expect(error).toBeInstanceOf(WidgetApiError);
      expect(error.kind).toBe(kind);
    }
  });

  it('accepts the login action in replies', async () => {
    responses.push(json(200, { reply: { text: 'x', lang: 'nl', citations: [], action: 'login' } }));
    expect((await api.sendMessage(session, 'q', 'nl')).action).toBe('login');
  });
});
