import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFreshdeskClient,
  FreshdeskError,
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

  it('never follows a next link to another host (the auth header would leak)', async () => {
    queue(200, [article(1)], { link: '<https://evil.example/steal?page=2>; rel="next"' });
    const articles = await client.listFolderArticles(101, 'nl');
    expect(articles.map((a) => a.id)).toEqual([1]);
    expect(requests).toHaveLength(1);
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
