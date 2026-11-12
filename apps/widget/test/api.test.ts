import { beforeEach, describe, expect, it } from 'vitest';
import { createWidgetApi, WidgetApiError } from '../src/lib/api.ts';

let requests: Request[];
let responses: (Response | Error)[];

const fakeFetch: typeof fetch = async (input, init) => {
  requests.push(new Request(input, init));
  const next = responses.shift();
  if (!next) throw new Error('no queued response');
  if (next instanceof Error) throw next;
  return next;
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const api = createWidgetApi({ baseUrl: 'https://api.test/', fetch: fakeFetch });
const session = { conversationId: '00000000-0000-4000-8000-000000000001', token: 't'.repeat(43) };

beforeEach(() => {
  requests = [];
  responses = [];
});

describe('createWidgetApi', () => {
  it('creates a conversation', async () => {
    responses.push(json(201, { conversationId: session.conversationId, token: session.token }));
    expect(await api.createConversation('nl')).toEqual(session);
    expect(requests[0]?.url).toBe('https://api.test/widget/conversations');
    expect(await requests[0]?.json()).toEqual({ lang: 'nl' });
  });

  it('sends a message with the bearer token and validates the reply', async () => {
    const reply = {
      text: 'Via de app.',
      lang: 'nl',
      citations: [{ articleId: 1, title: 'T', url: 'https://x/1' }],
      action: 'none',
    };
    responses.push(json(200, { reply }));
    expect(await api.sendMessage(session, 'Hoe zeg ik op?', 'nl')).toEqual(reply);
    expect(requests[0]?.url).toBe(
      `https://api.test/widget/conversations/${session.conversationId}/messages`,
    );
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${session.token}`);
    expect(await requests[0]?.json()).toEqual({ text: 'Hoe zeg ik op?', pageLang: 'nl' });
  });

  it('maps API errors to kinds', async () => {
    const cases: [Response | Error, string][] = [
      [json(409, { error: 'busy' }), 'busy'],
      [json(429, { error: 'rate_limited' }), 'rate_limited'],
      [json(404, { error: 'not_found' }), 'not_found'],
      [json(400, { error: 'verification_failed' }), 'verification_failed'],
      [json(400, { error: 'invalid_request' }), 'invalid'],
      [json(500, { error: 'internal' }), 'server'],
      [new TypeError('Failed to fetch'), 'network'],
      [json(200, { reply: { text: 1 } }), 'server'],
    ];
    for (const [response, kind] of cases) {
      responses.push(response);
      const error = await api.sendMessage(session, 'x', 'nl').catch((e) => e);
      expect(error).toBeInstanceOf(WidgetApiError);
      expect(error.kind).toBe(kind);
    }
  });

  it('submits a lead', async () => {
    responses.push(json(201, { ok: true }));
    await api.submitLead({
      email: 'a@example.com',
      question: 'q',
      lang: 'en',
      turnstileToken: 'tok',
      consent: true,
      conversationId: session.conversationId,
    });
    expect(requests[0]?.url).toBe('https://api.test/widget/leads');
    expect(await requests[0]?.json()).toMatchObject({ email: 'a@example.com', consent: true });
  });
});
