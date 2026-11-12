import { describe, expect, it } from 'vitest';
import { createTestApi, PORTAL_ORIGIN, portalLogin } from './helpers.ts';

type Api = ReturnType<typeof createTestApi>;

const get = (api: Api, url: string, session: string | null) =>
  api.app.inject({
    method: 'GET',
    url,
    headers: {
      ...(session ? { cookie: `tm_portal=${session}` } : {}),
      origin: PORTAL_ORIGIN,
    },
  });

describe('portal metrics API', () => {
  it('needs a signed-in agent', async () => {
    const api = createTestApi({ portal: {} });
    for (const url of ['/portal/api/metrics', '/portal/api/reports/2026-11-12']) {
      expect((await get(api, url, null)).statusCode).toBe(401);
    }
  });

  it('returns the days of a range with totals', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    const res = await get(api, '/portal/api/metrics?from=2026-11-10&to=2026-11-12', session);
    expect(res.statusCode).toBe(200);
    expect(api.metricsCalls).toEqual([['2026-11-10', '2026-11-12']]);
    const body = res.json();
    expect(body.days.map((d: { day: string }) => d.day)).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
    expect(body.totals).toEqual({
      conversations: 30,
      resolved: 18,
      escalations: 3,
      thumbsUp: 6,
      thumbsDown: 3,
      approvedAnswers: 3,
      logins: 9,
      flags: { no_match: 6 },
    });
  });

  it('defaults to the last 7 Amsterdam days and rejects bad ranges', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    expect((await get(api, '/portal/api/metrics', session)).statusCode).toBe(200);
    const [from, to] = api.metricsCalls[0] ?? [];
    expect(new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()).toBe(
      6 * 24 * 60 * 60 * 1000,
    );
    for (const query of [
      'from=2026-11-12&to=2026-11-10',
      'from=2026-01-01&to=2026-06-01',
      'from=2026-02-30&to=2026-03-01',
      'from=yesterday&to=2026-11-12',
    ]) {
      expect((await get(api, `/portal/api/metrics?${query}`, session)).statusCode).toBe(400);
    }
  });

  it('returns the stored topics of a report day', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    const res = await get(api, '/portal/api/reports/2026-11-12', session);
    expect(res.statusCode).toBe(200);
    expect(res.json().topics[0]).toMatchObject({ labelNl: 'Bevriezen', count: 2 });
    expect((await get(api, '/portal/api/reports/2026-11-11', session)).statusCode).toBe(404);
    expect((await get(api, '/portal/api/reports/not-a-day', session)).statusCode).toBe(400);
  });

  it('lists the conversations flagged on one Amsterdam day', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    expect((await get(api, '/portal/api/flagged?day=2026-10-25', session)).statusCode).toBe(200);
    expect(api.flaggedCalls.at(-1)).toMatchObject({
      since: new Date('2026-10-24T22:00:00Z'),
      until: new Date('2026-10-25T23:00:00Z'),
    });
    expect((await get(api, '/portal/api/flagged?day=2026-13-01', session)).statusCode).toBe(400);
  });
});
