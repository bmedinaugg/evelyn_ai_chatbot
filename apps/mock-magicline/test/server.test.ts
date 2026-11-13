import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profiles } from '../fixtures/profiles.ts';
import { buildMockServer, parseEmailAliases, parseMockKeys } from '../src/server.ts';

const keys = { crossStudio: 'cross-key', studios: { 1001: 'key-1001', 1002: 'key-1002' } };
let server: ReturnType<typeof buildMockServer>;

beforeEach(() => {
  server = buildMockServer({ keys, profiles });
});
afterEach(async () => {
  await server.close();
});

function search(email: unknown, apiKey?: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/cross-studio/customers/search',
    headers: apiKey ? { 'x-api-key': apiKey } : {},
    payload: email === undefined ? {} : { email },
  });
}

describe('cross-studio search', () => {
  it('401 without a key', async () => {
    expect((await search('multi@example.com')).statusCode).toBe(401);
  });

  it('finds a customer case-insensitively', async () => {
    const res = await search(' MULTI@example.com ', 'cross-key');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { studioId: number }) => c.studioId)).toEqual([1001, 1002]);
  });

  it('rejects a studio key on cross-studio search', async () => {
    expect((await search('multi@example.com', 'key-1001')).statusCode).toBe(401);
  });

  it('400 on a body without email', async () => {
    expect((await search(undefined, 'cross-key')).statusCode).toBe(400);
  });

  it('returns an empty list for an unknown email', async () => {
    expect((await search('nobody@example.com', 'cross-key')).json()).toEqual([]);
  });
});

describe('get customer by id', () => {
  function get(id: number, apiKey: string) {
    return server.inject({
      method: 'GET',
      url: `/v1/customers/${id}`,
      headers: { 'x-api-key': apiKey },
    });
  }

  it('studio key reads its own customer', async () => {
    const res = await get(1, 'key-1001');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 1, studioId: 1001 });
  });

  it('studio key cannot read another studio’s customer', async () => {
    expect((await get(3, 'key-1001')).statusCode).toBe(404);
  });

  it('401 with an unknown key', async () => {
    expect((await get(1, 'nope')).statusCode).toBe(401);
  });
});

describe('studio information', () => {
  it('returns the studio of the key', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/studios/information',
      headers: { 'x-api-key': 'key-1002' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ studioId: 1002, name: 'TrainMore Utrecht (test)' });
  });

  it('401 for the cross-studio key or an unknown key', async () => {
    for (const key of ['cross-key', 'nope']) {
      const res = await server.inject({
        method: 'GET',
        url: '/v1/studios/information',
        headers: { 'x-api-key': key },
      });
      expect(res.statusCode).toBe(401);
    }
  });
});

describe('parseMockKeys', () => {
  it('parses cross and studio keys', () => {
    expect(parseMockKeys('cross:a,1001:b,1002:c')).toEqual({
      crossStudio: 'a',
      studios: { 1001: 'b', 1002: 'c' },
    });
  });

  it('rejects malformed input', () => {
    expect(() => parseMockKeys('1001')).toThrow();
    expect(() => parseMockKeys('1001:b')).toThrow(/cross/);
    expect(() => parseMockKeys('cross:a,abc:b')).toThrow();
  });
});

describe('email aliases (preprod test logins with a real mailbox)', () => {
  const aliased = (email: string) =>
    buildMockServer({
      keys,
      profiles,
      emailAliases: parseEmailAliases(
        'AI+member@urbangymgroup.example=member.single@example.com, ai+multi@urbangymgroup.example=multi@example.com',
      ),
    }).inject({
      method: 'POST',
      url: '/v1/cross-studio/customers/search',
      headers: { 'x-api-key': 'cross-key' },
      payload: { email },
    });

  it('finds the synthetic profile for an alias, case-insensitively', async () => {
    const one = await aliased('ai+member@URBANGYMGROUP.example');
    expect(one.json().map((c: { id: number }) => c.id)).toEqual([1]);
    const multi = await aliased('AI+multi@urbangymgroup.example');
    expect(multi.json().map((c: { id: number }) => c.id)).toEqual([4, 5]);
  });

  it('leaves other addresses unchanged', async () => {
    expect((await aliased('former@example.com')).json().map((c: { id: number }) => c.id)).toEqual([
      3,
    ]);
    expect((await aliased('someone@urbangymgroup.example')).json()).toEqual([]);
  });

  it('has no aliases unless configured', async () => {
    expect((await search('ai+member@urbangymgroup.example', 'cross-key')).json()).toEqual([]);
  });

  it('rejects malformed alias lists', () => {
    expect(() => parseEmailAliases('no-equals-sign')).toThrow(/alias/i);
    expect(() => parseEmailAliases('a@x.example=not-an-email')).toThrow(/alias/i);
    expect(parseEmailAliases('')).toEqual({});
  });
});
