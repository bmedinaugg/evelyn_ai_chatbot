import { describe, expect, it } from 'vitest';
import { profiles } from '../fixtures/profiles.ts';
import { buildMockServer } from '../src/server.ts';

const keys = { crossStudio: 'cross-key', studios: { 1001: 'key-1001', 1002: 'key-1002' } };
const server = buildMockServer({ keys, profiles });
const get = (url: string, key: string) =>
  server.inject({ method: 'GET', url, headers: { 'x-api-key': key } });

describe('account data routes', () => {
  it('serves contracts, balance, payments and visits with the studio key', async () => {
    expect((await get('/v1/customers/1/contracts', 'key-1001')).json()[0]).toMatchObject({
      rateName: 'Flex',
      contractStatus: 'ACTIVE',
    });
    expect((await get('/v1/customers/1/account/balances', 'key-1001')).json()).toMatchObject({
      inDebtCollection: false,
    });
    expect(
      (await get('/v1/customers/1/account/transactions/upcoming?sliceSize=6', 'key-1001')).json()
        .result.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await get(
          '/v1/customers/1/activities/checkins?fromDate=2026-10-01&toDate=2026-11-30',
          'key-1001',
        )
      ).json().result.length,
    ).toBeGreaterThan(0);
  });

  it('a former member is in debt collection with an inactive, cancelled contract', async () => {
    expect((await get('/v1/customers/3/account/balances', 'key-1002')).json()).toMatchObject({
      inDebtCollection: true,
    });
    expect((await get('/v1/customers/3/contracts', 'key-1002')).json()[0]).toMatchObject({
      contractStatus: 'INACTIVE',
      cancelled: true,
    });
  });

  it('a studio key cannot read another studio’s customer', async () => {
    expect((await get('/v1/customers/3/contracts', 'key-1001')).statusCode).toBe(404);
    expect((await get('/v1/customers/1/account/balances', 'key-1002')).statusCode).toBe(404);
  });

  it('class bookings need the cross-studio key', async () => {
    expect(
      (await get('/v1/cross-studio/customers/1/class-bookings?daysAhead=14', 'key-1001'))
        .statusCode,
    ).toBe(401);
    const res = await get('/v1/cross-studio/customers/1/class-bookings?daysAhead=14', 'cross-key');
    expect(res.json().result[0]).toMatchObject({ classInformation: { title: expect.any(String) } });
  });
});
