import { createMagiclineClient } from '@trainmore/magicline';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { profiles } from '../fixtures/profiles.ts';
import { buildMockServer } from '../src/server.ts';

const server = buildMockServer({ keys: { crossStudio: 'cross-key', studios: {} }, profiles });
let baseUrl: string;

beforeAll(async () => {
  baseUrl = await server.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await server.close();
});

it('the real client finds both accounts for one email', async () => {
  const client = createMagiclineClient({ baseUrl, apiKey: 'cross-key' });
  expect(await client.searchCustomersCrossStudio(' Multi@Example.com ')).toEqual([
    { customerId: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' },
    { customerId: 5, studioId: 1002, status: 'MEMBER', customerNumber: 'M-0005' },
  ]);
});
