import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntraClaims } from '../src/portal/entra.ts';
import { createTestApi, PORTAL_ORIGIN } from './helpers.ts';

type Api = ReturnType<typeof createTestApi>;

function cookieValue(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = [setCookie ?? []].flat();
  const line = all.find((c) => c.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

function setCookieLine(setCookie: string | string[] | undefined, name: string): string {
  return [setCookie ?? []].flat().find((c) => c.startsWith(`${name}=`)) ?? '';
}

/** Full login: /login sets the signed login cookie, /callback turns it into a session cookie. */
async function login(api: Api) {
  const start = await api.app.inject({ method: 'GET', url: '/portal/auth/login' });
  const loginCookie = cookieValue(start.headers['set-cookie'], 'tm_portal_login') ?? '';
  const state = new URL(start.headers.location as string).searchParams.get('state') ?? '';
  const callback = await api.app.inject({
    method: 'GET',
    url: `/portal/auth/callback?code=the-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: `tm_portal_login=${loginCookie}` },
  });
  return {
    start,
    callback,
    loginCookie,
    state,
    session: cookieValue(callback.headers['set-cookie'], 'tm_portal'),
  };
}

const me = (api: Api, session?: string) =>
  api.app.inject({
    method: 'GET',
    url: '/portal/api/me',
    headers: session ? { cookie: `tm_portal=${session}` } : {},
  });

describe('portal login (Entra ID)', () => {
  it('is off without portal configuration', async () => {
    const api = createTestApi();
    expect((await api.app.inject({ method: 'GET', url: '/portal/auth/login' })).statusCode).toBe(
      404,
    );
    expect((await me(api)).statusCode).toBe(404);
  });

  it('redirects to Entra with PKCE and keeps state, nonce and verifier in a signed short cookie', async () => {
    const api = createTestApi({ portal: {} });
    const { start } = await login(api);
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toMatch(/^https:\/\/login\.example\/authorize\?/);
    const line = setCookieLine(start.headers['set-cookie'], 'tm_portal_login');
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Path=\/portal\/auth/);
    expect(line).toMatch(/Max-Age=600/);
    expect(api.entraCalls.authUrl[0]).toMatchObject({
      redirectUri: `${PORTAL_ORIGIN}/portal/auth/callback`,
    });
  });

  it('creates an 8-hour Strict session for an agent and stores only its hash', async () => {
    const api = createTestApi({ portal: {} });
    const { callback, session } = await login(api);
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/portal/');
    const line = setCookieLine(callback.headers['set-cookie'], 'tm_portal');
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Strict/);
    expect(line).toMatch(/Path=\/portal/);
    expect(line).toMatch(/Max-Age=28800/);
    // The login cookie is single use: cleared on the callback.
    expect(setCookieLine(callback.headers['set-cookie'], 'tm_portal_login')).toMatch(/Max-Age=0/);
    expect(session).toBeDefined();
    expect(api.portalSessions.has(session as string)).toBe(false);
    expect(
      api.portalSessions.has(
        createHash('sha256')
          .update(session as string)
          .digest('hex'),
      ),
    ).toBe(true);
    expect(api.audits).toEqual([
      expect.objectContaining({
        action: 'portal.login',
        actor: { oid: 'oid-agent-1', name: 'Agent One' },
      }),
    ]);
    const res = await me(api, session);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'Agent One', roles: ['agent'] });
    // The PKCE verifier from the login cookie reached the code exchange.
    expect(api.entraCalls.redeem[0]).toMatchObject({
      code: 'the-code',
      codeVerifier: expect.any(String),
    });
  });

  it('refuses a callback whose state does not match the login cookie', async () => {
    const api = createTestApi({ portal: {} });
    const start = await api.app.inject({ method: 'GET', url: '/portal/auth/login' });
    const loginCookie = cookieValue(start.headers['set-cookie'], 'tm_portal_login') ?? '';
    const res = await api.app.inject({
      method: 'GET',
      url: '/portal/auth/callback?code=c&state=forged',
      headers: { cookie: `tm_portal_login=${loginCookie}` },
    });
    // A browser navigation: back to the portal, which explains it in nl/en and offers a retry.
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/portal/?signin_error=invalid');
    expect(api.entraCalls.redeem).toEqual([]);
    expect(api.portalSessions.size).toBe(0);
  });

  it('refuses a tampered or missing login cookie', async () => {
    const api = createTestApi({ portal: {} });
    const { loginCookie, state } = await login(createTestApi({ portal: {} }));
    const tampered = `${loginCookie.slice(0, -2)}xx`;
    for (const cookie of [`tm_portal_login=${tampered}`, '']) {
      const res = await api.app.inject({
        method: 'GET',
        url: `/portal/auth/callback?code=c&state=${encodeURIComponent(state)}`,
        headers: cookie ? { cookie } : {},
      });
      expect(res.headers.location).toBe('/portal/?signin_error=invalid');
    }
    expect(api.portalSessions.size).toBe(0);
  });

  it('refuses a token from another tenant, for another app, with a wrong nonce or without a role', async () => {
    for (const [claims, reason] of [
      [{ tid: '99999999-9999-4999-8999-999999999999' }, 'invalid'],
      [{ aud: '99999999-9999-4999-8999-999999999999' }, 'invalid'],
      [{ nonce: 'other' }, 'invalid'],
      [{ roles: [] }, 'no_role'],
      [{ roles: ['Reader'] }, 'no_role'],
    ] satisfies [Partial<EntraClaims>, 'invalid' | 'no_role'][]) {
      const api = createTestApi({ portal: { claims } });
      const { callback } = await login(api);
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe(`/portal/?signin_error=${reason}`);
      expect(setCookieLine(callback.headers['set-cookie'], 'tm_portal')).toBe('');
      expect(api.portalSessions.size).toBe(0);
    }
  });

  it('sends a sign-in cancelled at Microsoft back to the portal', async () => {
    const api = createTestApi({ portal: {} });
    const res = await api.app.inject({
      method: 'GET',
      url: '/portal/auth/callback?error=access_denied&state=x',
    });
    expect(res.headers.location).toBe('/portal/?signin_error=invalid');
  });

  it('needs a valid, unexpired session for the portal API', async () => {
    const api = createTestApi({ portal: {} });
    expect((await me(api)).statusCode).toBe(401);
    expect((await me(api, 'not-a-session')).statusCode).toBe(401);
    const { session } = await login(api);
    for (const value of api.portalSessions.values()) value.expiresAt = new Date(Date.now() - 1000);
    expect((await me(api, session)).statusCode).toBe(401);
  });

  it('logs out only from the portal itself (Origin check) and ends the session', async () => {
    const api = createTestApi({ portal: {} });
    const { session } = await login(api);
    const logout = (origin?: string) =>
      api.app.inject({
        method: 'POST',
        url: '/portal/auth/logout',
        headers: { cookie: `tm_portal=${session}`, ...(origin ? { origin } : {}) },
      });
    expect((await logout('https://evil.example')).statusCode).toBe(403);
    expect((await logout()).statusCode).toBe(403);
    const res = await logout(PORTAL_ORIGIN);
    expect(res.statusCode).toBe(204);
    expect(setCookieLine(res.headers['set-cookie'], 'tm_portal')).toMatch(/Max-Age=0/);
    expect((await me(api, session)).statusCode).toBe(401);
  });
});
