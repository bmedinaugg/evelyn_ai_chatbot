import { describe, expect, it } from 'vitest';
import { createTestApi, ORIGIN } from './helpers.ts';

type Api = ReturnType<typeof createTestApi>;
type Conv = { conversationId: string; token: string };

const form = {
  email: ' Sam@Example.com ',
  name: 'Sam',
  topic: 'Payments & invoices',
  subject: 'Dubbele afschrijving',
  description: 'Ik ben deze maand <b>twee keer</b> afgeschreven.',
  lang: 'nl',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  consent: true,
};

async function start(api: Api): Promise<Conv> {
  const res = await api.app.inject({
    method: 'POST',
    url: '/widget/conversations',
    headers: { origin: ORIGIN },
    payload: { lang: 'nl' },
  });
  return res.json() as Conv;
}

function submit(api: Api, conv: Conv, payload: Record<string, unknown> = form, token = conv.token) {
  return api.app.inject({
    method: 'POST',
    url: `/widget/conversations/${conv.conversationId}/tickets`,
    headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
    payload,
  });
}

function say(api: Api, conv: Conv, text: string) {
  return api.app.inject({
    method: 'POST',
    url: `/widget/conversations/${conv.conversationId}/messages`,
    headers: { origin: ORIGIN, authorization: `Bearer ${conv.token}` },
    payload: { text, pageLang: 'nl' },
  });
}

async function login(api: Api, conv: Conv, email: string) {
  const call = (path: string, payload: Record<string, unknown>) =>
    api.app.inject({
      method: 'POST',
      url: `/widget/conversations/${conv.conversationId}/login/${path}`,
      headers: { origin: ORIGIN, authorization: `Bearer ${conv.token}` },
      payload,
    });
  await call('request', { email, lang: 'nl', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' });
  const res = await call('verify', { email, code: api.sentCodes.at(-1)?.code });
  expect(res.json()).toMatchObject({ selected: 0 });
}

describe('GET /widget/ticket-topics', () => {
  const topics = (api: Api, lang: string) =>
    api.app.inject({
      method: 'GET',
      url: `/widget/ticket-topics?lang=${lang}`,
      headers: { origin: ORIGIN },
    });

  it('returns the built-in topics with nl labels when nothing is synced', async () => {
    const res = await topics(createTestApi(), 'nl');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      topics: [
        { value: 'Membership & contract', label: 'Lidmaatschap & contract' },
        { value: 'Payments & invoices', label: 'Betalingen & facturen' },
        { value: 'Club & facilities', label: 'Club & faciliteiten' },
        { value: 'App & account', label: 'App & account' },
      ],
    });
  });

  it('returns the synced topics, labelling known ones', async () => {
    const res = await topics(
      createTestApi({ topics: ['Payments & invoices', 'Personal training'] }),
      'en',
    );
    expect(res.json()).toEqual({
      topics: [
        { value: 'Payments & invoices', label: 'Payments & invoices' },
        { value: 'Personal training', label: 'Personal training' },
      ],
    });
  });

  it('falls back to the built-in topics when the database is down', async () => {
    const res = await topics(createTestApi({ topicsError: true }), 'en');
    expect(res.json().topics).toHaveLength(4);
  });

  it('rejects an unknown language', async () => {
    expect((await topics(createTestApi(), 'de')).statusCode).toBe(400);
  });
});

describe('POST /widget/conversations/:id/tickets', () => {
  it('creates a ticket with the topic as type, a transcript note and an escalation record', async () => {
    const api = createTestApi();
    const conv = await start(api);
    await say(api, conv, 'Ik wil een mens');
    const res = await submit(api, conv);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
    expect(api.tickets).toEqual([
      {
        email: 'sam@example.com',
        name: 'Sam',
        subject: 'Dubbele afschrijving',
        descriptionText: 'Ik ben deze maand <b>twee keer</b> afgeschreven.',
        tags: ['chatbot', 'escalation', 'nl'],
        type: 'Payments & invoices',
      },
    ]);
    expect(api.notes).toHaveLength(1);
    expect(api.notes[0]?.ticketId).toBe(777);
    expect(api.notes[0]?.text).toContain('Account: niet ingelogd');
    expect(api.notes[0]?.text).toContain('Klant: Ik wil een mens');
    expect(api.notes[0]?.text).toContain('Chatbot: Of course.');
    expect(api.escalations).toEqual([
      {
        conversationId: conv.conversationId,
        freshdeskTicketId: 777,
        topic: 'Payments & invoices',
        reason: 'customer_request',
      },
    ]);
    expect(api.logs()).not.toContain('sam@example.com');
    expect(api.logs()).not.toContain('Sam');
  });

  it('needs the conversation token: 401 without, 404 with a wrong one', async () => {
    const api = createTestApi();
    const conv = await start(api);
    const none = await api.app.inject({
      method: 'POST',
      url: `/widget/conversations/${conv.conversationId}/tickets`,
      headers: { origin: ORIGIN },
      payload: form,
    });
    expect(none.statusCode).toBe(401);
    expect((await submit(api, conv, form, 'x'.repeat(43))).statusCode).toBe(404);
    expect(api.tickets).toEqual([]);
  });

  it('rejects a topic that is not offered', async () => {
    const api = createTestApi({ topics: ['Personal training'] });
    const conv = await start(api);
    const res = await submit(api, conv, { ...form, topic: 'Payments & invoices' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(api.tickets).toEqual([]);
    expect(api.turnstileIps).toEqual([]);
  });

  it('needs Turnstile and consent', async () => {
    const failing = createTestApi({ turnstileOk: false });
    const conv = await start(failing);
    expect((await submit(failing, conv)).json()).toEqual({ error: 'verification_failed' });
    expect(failing.tickets).toEqual([]);

    const api = createTestApi();
    const conv2 = await start(api);
    expect((await submit(api, conv2, { ...form, consent: false })).statusCode).toBe(400);
    expect((await submit(api, conv2, { ...form, email: 'nope' })).statusCode).toBe(400);
  });

  it('still answers 201 when the note fails (the ticket exists)', async () => {
    const api = createTestApi({ noteError: new Error('Freshdesk 500') });
    const conv = await start(api);
    const res = await submit(api, conv);
    expect(res.statusCode).toBe(201);
    expect(api.tickets).toHaveLength(1);
    expect(api.escalations).toHaveLength(1);
    expect(api.logs()).toContain('ticket note failed');
  });

  it('answers 502 when Freshdesk refuses the ticket', async () => {
    const api = createTestApi({ ticketError: new Error('Freshdesk 503') });
    const conv = await start(api);
    expect((await submit(api, conv)).statusCode).toBe(502);
    expect(api.escalations).toEqual([]);
  });

  it('adds status and club only when the form email is the verified one', async () => {
    const api = createTestApi();
    const conv = await start(api);
    await login(api, conv, 'sam@example.com');
    await submit(api, conv);
    expect(api.notes[0]?.text).toContain('Account: Lid, Club 1001 (geverifieerd via e-mailcode)');
    expect(api.notes[0]?.text).not.toContain('4');

    const other = await start(api);
    await login(api, other, 'sam@example.com');
    await submit(api, other, { ...form, email: 'someone.else@example.com' });
    expect(api.notes[1]?.text).toContain('Account: niet ingelogd');
  });

  it('records a stuck escalation after the bot could not help', async () => {
    const api = createTestApi({
      answer: {
        kind: 'answer',
        answer: {
          language: 'nl',
          intent: 'faq',
          answer: 'x',
          citedArticleIds: [],
          confidence: 'low',
          needsHuman: false,
        },
        assistantContent: [],
        steps: [],
        toolsUsed: [],
      },
    });
    const conv = await start(api);
    await say(api, conv, 'Vraag');
    await submit(api, conv);
    expect(api.escalations[0]?.reason).toBe('stuck');
  });
});
