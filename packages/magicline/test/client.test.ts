import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMagiclineClient,
  MagiclineError,
  MagiclineRateLimitError,
  MagiclineResponseError,
} from '../src/index.ts';

let req: Request;
let calls: number;
let nextResponse: Response;

function respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
  nextResponse = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const fakeFetch: typeof fetch = async (input, init) => {
  calls += 1;
  req = new Request(input, init);
  return nextResponse;
};

const client = createMagiclineClient({ baseUrl: 'http://mock', apiKey: 'k', fetch: fakeFetch });

beforeEach(() => {
  calls = 0;
  respond(200, []);
});

describe('searchCustomersCrossStudio', () => {
  it('normalises the email and sends the API key', async () => {
    await client.searchCustomersCrossStudio('  Jan@Example.com ');
    expect(req.method).toBe('POST');
    expect(req.url).toBe('http://mock/v1/cross-studio/customers/search');
    expect(req.headers.get('X-API-KEY')).toBe('k');
    expect(await req.json()).toEqual({ email: 'jan@example.com' });
  });

  it('returns only id, studio and status, dropping other PII fields', async () => {
    respond(200, [
      {
        id: 1,
        studioId: 1001,
        status: 'MEMBER',
        email: 'jan@example.com',
        firstName: 'Jan',
        street: 'x',
      },
    ]);
    expect(await client.searchCustomersCrossStudio('jan@example.com')).toEqual([
      { customerId: 1, studioId: 1001, status: 'MEMBER' },
    ]);
  });

  it('rejects an unknown status', async () => {
    respond(200, [{ id: 1, studioId: 1001, status: 'VIP' }]);
    await expect(client.searchCustomersCrossStudio('a@example.com')).rejects.toBeInstanceOf(
      MagiclineResponseError,
    );
  });

  it('maps 429 to a rate-limit error with retry-after', async () => {
    respond(429, {}, { 'x-ratelimit-reset': '12' });
    const error = await client.searchCustomersCrossStudio('a@example.com').catch((e) => e);
    expect(error).toBeInstanceOf(MagiclineRateLimitError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 12 });
  });

  it('maps other non-2xx to MagiclineError without leaking the body', async () => {
    respond(500, { message: 'boom jan@example.com' });
    const error = await client.searchCustomersCrossStudio('a@example.com').catch((e) => e);
    expect(error).toBeInstanceOf(MagiclineError);
    expect(error.status).toBe(500);
    expect(String(error.message)).not.toContain('jan@example.com');
  });

  it('rejects an empty email before calling the API', async () => {
    await expect(client.searchCustomersCrossStudio('  ')).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
