import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFreshdeskClient,
  FreshdeskError,
  FreshdeskPaginationError,
  FreshdeskRateLimitError,
  FreshdeskResponseError,
} from '../src/index.ts';

let requests: Request[];
let responses: Response[];

function queue(status: number, body: unknown, headers: Record<string, string> = {}): void {
  responses.push(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );
}

const fakeFetch: typeof fetch = async (input, init) => {
  requests.push(new Request(input, init));
  const next = responses.shift();
  if (!next) throw new Error('no queued response');
  return next;
};

const client = createFreshdeskClient({
  domain: 'tm.freshdesk.com',
  apiKey: 'key',
  fetch: fakeFetch,
});

const article = (id: number) => ({
  id,
  folder_id: 101,
  title: `Title ${id}`,
  description: '<p>Body</p>',
  status: 2,
  updated_at: '2026-11-01T10:00:00Z',
  seo_data: { meta_title: 'x' },
  agent_id: 9,
});

beforeEach(() => {
  requests = [];
  responses = [];
});

describe('listFolderArticles', () => {
  it('sends basic auth and lists the folder in the requested language', async () => {
    queue(200, [article(1)]);
    await client.listFolderArticles(101, 'nl');
    expect(requests[0]?.url).toBe(
      'https://tm.freshdesk.com/api/v2/solutions/folders/101/articles/nl?per_page=100&page=1',
    );
    expect(requests[0]?.headers.get('authorization')).toBe(`Basic ${btoa('key:X')}`);
  });

  it('follows rel="next" pagination', async () => {
    queue(200, [article(1)], {
      link: '<https://tm.freshdesk.com/api/v2/solutions/folders/101/articles/en?per_page=100&page=2>; rel="next"',
    });
    queue(200, [article(2)]);
    const articles = await client.listFolderArticles(101, 'en');
    expect(articles.map((a) => a.id)).toEqual([1, 2]);
    expect(requests[1]?.url).toContain('page=2');
  });

  it('throws instead of following a next link to another host (the auth header would leak)', async () => {
    queue(200, [article(1)], { link: '<https://evil.example/steal?page=2>; rel="next"' });
    const error = await client.listFolderArticles(101, 'nl').catch((e) => e);
    expect(error).toBeInstanceOf(FreshdeskPaginationError);
    expect(requests).toHaveLength(1);
  });

  it('keeps paging when a full page has no link header', async () => {
    queue(
      200,
      Array.from({ length: 100 }, (_, i) => article(i + 1)),
    );
    queue(200, [article(101), article(102)]);
    const articles = await client.listFolderArticles(101, 'nl');
    expect(articles).toHaveLength(102);
    expect(requests[1]?.url).toContain('page=2');
  });

  it('throws when the page limit is reached with more pages left', async () => {
    for (let page = 0; page < 50; page += 1) {
      queue(
        200,
        Array.from({ length: 100 }, (_, i) => article(page * 100 + i + 1)),
      );
    }
    const error = await client.listFolderArticles(101, 'nl').catch((e) => e);
    expect(error).toBeInstanceOf(FreshdeskPaginationError);
  });

  it('strips unknown fields and maps names', async () => {
    queue(200, [article(1)]);
    expect(await client.listFolderArticles(101, 'nl')).toEqual([
      {
        id: 1,
        folderId: 101,
        title: 'Title 1',
        descriptionHtml: '<p>Body</p>',
        status: 2,
        updatedAt: '2026-11-01T10:00:00Z',
      },
    ]);
  });

  it('rejects an article without a title', async () => {
    const { title: _omitted, ...broken } = article(1);
    queue(200, [broken]);
    await expect(client.listFolderArticles(101, 'nl')).rejects.toBeInstanceOf(
      FreshdeskResponseError,
    );
  });

  it('maps 429 with Retry-After', async () => {
    queue(429, {}, { 'retry-after': '30' });
    const error = await client.listFolderArticles(101, 'nl').catch((e) => e);
    expect(error).toBeInstanceOf(FreshdeskRateLimitError);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('does not leak response bodies in errors', async () => {
    queue(500, { message: 'boom for jan@example.com' });
    const error = await client.listFolderArticles(101, 'nl').catch((e) => e);
    expect(error).toBeInstanceOf(FreshdeskError);
    expect(error.status).toBe(500);
    expect(String(error.message)).not.toContain('jan@example.com');
  });
});

describe('createTicket', () => {
  it('creates a ticket with an escaped HTML description', async () => {
    queue(201, { id: 55, subject: 's' });
    await client.createTicket({
      email: 'lead@example.com',
      subject: 'Question',
      descriptionText: '<script>x</script>\nhi',
      tags: ['chatbot', 'lead'],
    });
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('https://tm.freshdesk.com/api/v2/tickets');
    expect(await requests[0]?.json()).toEqual({
      email: 'lead@example.com',
      subject: 'Question',
      description: '&lt;script&gt;x&lt;/script&gt;<br>hi',
      tags: ['chatbot', 'lead'],
      status: 2,
      priority: 1,
      source: 7,
    });
  });

  it('includes the phone only when given', async () => {
    queue(201, { id: 56 });
    await client.createTicket({
      email: 'lead@example.com',
      subject: 'Q',
      descriptionText: 'hi',
      tags: [],
      phone: '+31612345678',
    });
    expect(await requests[0]?.json()).toMatchObject({ phone: '+31612345678' });
  });

  it('returns the created ticket id', async () => {
    queue(201, { id: 55, subject: 's' });
    expect(
      await client.createTicket({
        email: 'a@example.com',
        subject: 'Q',
        descriptionText: 'hi',
        tags: [],
      }),
    ).toEqual({ id: 55 });
  });
});

describe('ticket fields, notes and types', () => {
  it('lists ticket fields with their dropdown choices', async () => {
    queue(200, [
      {
        id: 1,
        name: 'ticket_type',
        label_for_customers: 'Type',
        type: 'default_ticket_type',
        choices: ['Membership', 'Payments'],
      },
      {
        id: 2,
        name: 'status',
        type: 'default_status',
        choices: { '2': ['Open', 'Being processed'] },
      },
      { id: 3, name: 'subject', type: 'default_subject' },
    ]);
    expect(await client.listTicketFields()).toEqual([
      { name: 'ticket_type', choices: ['Membership', 'Payments'] },
      { name: 'status', choices: [] },
      { name: 'subject', choices: [] },
    ]);
    expect(requests[0]?.url).toBe('https://tm.freshdesk.com/api/v2/ticket_fields');
  });

  it('adds a private note with escaped text', async () => {
    queue(201, { id: 9, body: 'x' });
    await client.addPrivateNote(55, 'Klant: <b>hoi</b>\nBot: hallo');
    expect(requests[0]?.url).toBe('https://tm.freshdesk.com/api/v2/tickets/55/notes');
    expect(await requests[0]?.json()).toEqual({
      body: 'Klant: &lt;b&gt;hoi&lt;/b&gt;<br>Bot: hallo',
      private: true,
    });
  });

  it('sends the ticket type when given', async () => {
    queue(201, { id: 56 });
    await client.createTicket({
      email: 'a@example.com',
      subject: 'Q',
      descriptionText: 'hi',
      tags: [],
      type: 'Payments',
    });
    expect(await requests[0]?.json()).toMatchObject({ type: 'Payments' });
  });

  it('sends the requester name when given', async () => {
    queue(201, { id: 57 });
    await client.createTicket({
      email: 'a@example.com',
      name: 'Sam',
      subject: 'Q',
      descriptionText: 'hi',
      tags: [],
    });
    expect(await requests[0]?.json()).toMatchObject({ email: 'a@example.com', name: 'Sam' });
  });
});
