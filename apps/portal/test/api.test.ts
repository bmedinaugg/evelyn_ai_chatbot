import { beforeEach, describe, expect, it } from 'vitest';
import { createPortalApi, PortalApiError } from '../src/lib/api.ts';

let requests: Request[];
let responses: Response[];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const api = createPortalApi({
  fetch: async (input, init) => {
    requests.push(new Request(new URL(String(input), 'https://portal.test'), init));
    const next = responses.shift();
    if (!next) throw new Error('no queued response');
    return next;
  },
});

beforeEach(() => {
  requests = [];
  responses = [];
});

describe('createPortalApi', () => {
  it('reads the signed-in agent', async () => {
    responses.push(json(200, { name: 'Agent One', roles: ['agent'] }));
    expect(await api.me()).toEqual({ name: 'Agent One', roles: ['agent'] });
    expect(requests[0]?.url).toBe('https://portal.test/portal/api/me');
  });

  it('maps 401 and 403 to typed errors', async () => {
    responses.push(json(401, { error: 'unauthorized' }), json(403, { error: 'forbidden' }));
    await expect(api.me()).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(api.me()).rejects.toBeInstanceOf(PortalApiError);
  });

  it('lists flagged conversations with filters', async () => {
    responses.push(json(200, { conversations: [], pageSize: 50 }));
    await api.flagged({ reason: 'thumbs_down', days: 7, page: 1 });
    expect(requests[0]?.url).toBe(
      'https://portal.test/portal/api/flagged?days=7&page=1&reason=thumbs_down',
    );
  });

  it('switches a capability with PUT', async () => {
    responses.push(new Response(null, { status: 204 }));
    await api.setCapability('get_recent_visits', false);
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe('https://portal.test/portal/api/capabilities/get_recent_visits');
    expect(await requests[0]?.json()).toEqual({ enabled: false });
  });

  it('rejects an unexpected response shape', async () => {
    responses.push(json(200, { name: 1 }));
    await expect(api.me()).rejects.toMatchObject({ kind: 'server' });
  });
});
