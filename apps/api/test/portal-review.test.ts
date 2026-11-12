import { describe, expect, it } from 'vitest';
import { createTestApi, PORTAL_ORIGIN, portalLogin } from './helpers.ts';

type Api = ReturnType<typeof createTestApi>;
const CONV = '00000000-0000-4000-8000-000000000001';

function call(
  api: Api,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  session: string | null,
  options: { origin?: string; payload?: unknown } = {},
) {
  return api.app.inject({
    method,
    url,
    headers: {
      ...(session ? { cookie: `tm_portal=${session}` } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });
}

describe('portal review API', () => {
  it('needs a signed-in agent everywhere', async () => {
    const api = createTestApi({ portal: {} });
    for (const [method, url] of [
      ['GET', '/portal/api/flagged'],
      ['GET', `/portal/api/conversations/${CONV}`],
      ['POST', `/portal/api/conversations/${CONV}/reveal`],
      ['GET', '/portal/api/capabilities'],
      ['PUT', '/portal/api/capabilities/get_recent_visits'],
    ] as const) {
      expect((await call(api, method, url, null, { origin: PORTAL_ORIGIN })).statusCode).toBe(401);
    }
  });

  it('lists flagged conversations', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    const res = await call(api, 'GET', '/portal/api/flagged?reason=thumbs_down&days=7', session);
    expect(res.statusCode).toBe(200);
    expect(res.json().conversations[0]).toMatchObject({
      conversationId: CONV,
      reasons: ['no_match', 'thumbs_down'],
    });
    expect(
      (await call(api, 'GET', '/portal/api/flagged?reason=nonsense', session)).statusCode,
    ).toBe(400);
  });

  it('shows a conversation with personal data masked', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    const res = await call(api, 'GET', `/portal/api/conversations/${CONV}`, session);
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).not.toContain('sam@example.com');
    expect(body).not.toContain('0612345678');
    expect(res.json().messages[0].text).toBe('Ik ben Sam, mail [•••] of bel [•••]');
    expect(res.json().messages[1]).toMatchObject({ outcome: 'no_match', rating: 'down' });
    expect(api.audits.filter((a) => a.action === 'conversation.reveal')).toEqual([]);
    expect(
      (
        await call(
          api,
          'GET',
          '/portal/api/conversations/00000000-0000-4000-8000-000000000099',
          session,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('reveals the original only on request from the portal, and audits it', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    expect(
      (
        await call(api, 'POST', `/portal/api/conversations/${CONV}/reveal`, session, {
          origin: 'https://evil.example',
        })
      ).statusCode,
    ).toBe(403);
    const res = await call(api, 'POST', `/portal/api/conversations/${CONV}/reveal`, session, {
      origin: PORTAL_ORIGIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages[0].text).toContain('sam@example.com');
    expect(api.audits).toContainEqual(
      expect.objectContaining({
        action: 'conversation.reveal',
        entityId: CONV,
        actor: { oid: 'oid-agent-1', name: 'Agent One' },
      }),
    );
  });

  it('lists capabilities with who they apply to and whether they are on', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    const res = await call(api, 'GET', '/portal/api/capabilities', session);
    expect(res.statusCode).toBe(200);
    expect(res.json().capabilities).toContainEqual({
      name: 'get_recent_visits',
      statuses: ['MEMBER'],
      enabled: true,
    });
  });

  it('lets only admins switch a capability, from the portal, and audits it', async () => {
    const agent = createTestApi({ portal: {} });
    const agentSession = await portalLogin(agent);
    expect(
      (
        await call(agent, 'PUT', '/portal/api/capabilities/get_recent_visits', agentSession, {
          origin: PORTAL_ORIGIN,
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(403);

    const api = createTestApi({
      portal: { claims: { roles: ['admin'], oid: 'oid-admin', name: 'Admin' } },
    });
    const session = await portalLogin(api);
    const put = (url: string, payload: unknown, origin = PORTAL_ORIGIN) =>
      call(api, 'PUT', url, session, { origin, payload });
    expect(
      (
        await put(
          '/portal/api/capabilities/get_recent_visits',
          { enabled: false },
          'https://evil.example',
        )
      ).statusCode,
    ).toBe(403);
    expect((await put('/portal/api/capabilities/not_a_tool', { enabled: false })).statusCode).toBe(
      404,
    );
    expect(
      (await put('/portal/api/capabilities/get_recent_visits', { enabled: 'no' })).statusCode,
    ).toBe(400);
    expect(
      (await put('/portal/api/capabilities/get_recent_visits', { enabled: false })).statusCode,
    ).toBe(204);
    expect(api.capabilitySwitches).toEqual([
      { name: 'get_recent_visits', enabled: false, actor: 'oid-admin' },
    ]);
    expect(api.audits).toContainEqual(
      expect.objectContaining({ action: 'capability.set', entityId: 'get_recent_visits' }),
    );
  });
});
