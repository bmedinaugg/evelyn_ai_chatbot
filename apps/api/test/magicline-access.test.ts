import { createStaticKeyResolver } from '@trainmore/magicline';
import { describe, expect, it } from 'vitest';
import { createMagiclineAccess } from '../src/magicline-access.ts';

describe('createMagiclineAccess', () => {
  it('searches with the cross-studio key and names studios with their own key (cached)', async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const req = new Request(input, init);
      requests.push(req);
      const body = req.url.endsWith('/customers/search')
        ? [{ id: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' }]
        : { studioId: 1001, name: 'Club A' };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const access = createMagiclineAccess({
      baseUrl: 'http://mock',
      keys: createStaticKeyResolver({ crossStudio: 'cross', studios: { 1001: 'k1001' } }),
      fetch: fakeFetch,
    });
    expect(await access.searchByEmail('a@example.com')).toEqual([
      { customerId: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' },
    ]);
    expect(requests[0]?.headers.get('x-api-key')).toBe('cross');
    expect(await access.studioName(1001)).toBe('Club A');
    expect(await access.studioName(1001)).toBe('Club A');
    expect(requests.filter((r) => r.url.endsWith('/studios/information'))).toHaveLength(1);
    expect(requests[1]?.headers.get('x-api-key')).toBe('k1001');
  });
});
