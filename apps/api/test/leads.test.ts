import { describe, expect, it } from 'vitest';
import { createTestApi, ORIGIN } from './helpers.ts';

const lead = {
  email: ' Lead@Example.com ',
  phone: '+31 6 1234 5678',
  question: 'Wat kost een <b>lidmaatschap</b>?',
  lang: 'nl',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  consent: true,
};

function submit(api: ReturnType<typeof createTestApi>, payload: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: '/widget/leads',
    headers: { origin: ORIGIN },
    payload,
  });
}

describe('POST /widget/leads', () => {
  it('creates a Freshdesk ticket and records the lead without personal data', async () => {
    const api = createTestApi();
    const res = await submit(api, lead);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
    expect(api.tickets).toEqual([
      {
        email: 'lead@example.com',
        phone: '+31 6 1234 5678',
        subject: 'Nieuwe lidmaatschapsvraag via websitechat',
        descriptionText: 'Wat kost een <b>lidmaatschap</b>?\n\n—\nSource: website chat (lead form)',
        tags: ['chatbot', 'lead', 'nl'],
      },
    ]);
    expect(api.leads).toEqual([{ conversationId: null, freshdeskTicketId: 777, lang: 'nl' }]);
  });

  it('tags leads from a non-production environment', async () => {
    const api = createTestApi({ envTag: 'chatbot-preprod' });
    await submit(api, lead);
    expect(api.tickets[0]?.tags).toEqual(['chatbot', 'lead', 'nl', 'chatbot-preprod']);
  });

  it('links the lead to a conversation when given', async () => {
    const api = createTestApi();
    const conversationId = '00000000-0000-4000-8000-000000000042';
    await submit(api, { ...lead, conversationId });
    expect(api.leads[0]?.conversationId).toBe(conversationId);
  });

  it('creates no ticket when Turnstile fails', async () => {
    const api = createTestApi({ turnstileOk: false });
    const res = await submit(api, lead);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'verification_failed' });
    expect(api.tickets).toHaveLength(0);
  });

  it('validates the email, phone and consent', async () => {
    const api = createTestApi();
    expect((await submit(api, { ...lead, email: 'not-an-email' })).statusCode).toBe(400);
    expect((await submit(api, { ...lead, phone: 'call me' })).statusCode).toBe(400);
    expect((await submit(api, { ...lead, consent: false })).statusCode).toBe(400);
    const { consent: _omitted, ...withoutConsent } = lead;
    expect((await submit(api, withoutConsent)).statusCode).toBe(400);
    expect(api.tickets).toHaveLength(0);
  });

  it('returns 502 and records nothing when Freshdesk fails', async () => {
    const api = createTestApi({ ticketError: new Error('Freshdesk /tickets failed with 500') });
    const res = await submit(api, lead);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'unavailable' });
    expect(api.leads).toHaveLength(0);
  });

  it('still confirms the lead when recording it fails after the ticket exists (no duplicate tickets)', async () => {
    const api = createTestApi({ recordLeadError: 'always' });
    const res = await submit(api, lead);
    expect(res.statusCode).toBe(201);
    expect(api.tickets).toHaveLength(1);
  });

  it('drops an unknown conversation link instead of failing', async () => {
    const api = createTestApi({ recordLeadError: 'with-conversation' });
    const res = await submit(api, {
      ...lead,
      conversationId: '00000000-0000-4000-8000-0000000000ff',
    });
    expect(res.statusCode).toBe(201);
    expect(api.leads).toEqual([{ conversationId: null, freshdeskTicketId: 777, lang: 'nl' }]);
  });

  it('never logs the email or the question', async () => {
    const api = createTestApi({ ticketError: new Error('boom') });
    await submit(api, lead);
    await submit(createTestApi(), lead);
    expect(api.logs()).not.toMatch(/lead@example\.com|lidmaatschap/i);
  });

  it('rate-limits lead submissions per IP', async () => {
    const api = createTestApi();
    for (let i = 0; i < 5; i += 1) expect((await submit(api, lead)).statusCode).toBe(201);
    expect((await submit(api, lead)).statusCode).toBe(429);
  });
});
