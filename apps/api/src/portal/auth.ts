import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Reply } from '@trainmore/core';
import {
  type CustomerStatus,
  PORTAL_ROLES,
  type PortalRepository,
  type PortalRole,
  type PortalSession,
  type ScenarioHit,
  type ScenarioRepository,
} from '@trainmore/db';
import type { Lang } from '@trainmore/i18n';
import type { PortalConfig } from '@trainmore/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseCookies, serializeCookie, signValue, verifySignedValue } from './cookies.ts';
import type { EntraClient } from './entra.ts';

/** Re-asks a conversation's questions with a draft approved answer (core replayConversation). */
export type ReplayRunner = (input: {
  questions: string[];
  pageLang: Lang;
  status: CustomerStatus | null;
  draft: ScenarioHit;
}) => Promise<{ question: string; reply: Reply }[]>;

export type PortalDeps = {
  config: PortalConfig;
  entra: EntraClient;
  repo: PortalRepository;
  scenarios: ScenarioRepository;
  /** Null where Magicline is not the mock (production): replay is refused there. */
  replay: ReplayRunner | null;
};

const LOGIN_COOKIE = 'tm_portal_login';
const SESSION_COOKIE = 'tm_portal';
const LOGIN_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const loginState = z.object({ state: z.string(), nonce: z.string(), verifier: z.string() });

const random = () => randomBytes(32).toString('base64url');
const sha256 = (value: string, encoding: 'hex' | 'base64url') =>
  createHash('sha256').update(value).digest(encoding);

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function portalOrigin(config: PortalConfig): string {
  return new URL(config.baseUrl).origin;
}

/** Changes are only accepted from the portal itself (with SameSite=Strict: CSRF defence). */
export function isFromPortal(request: FastifyRequest, config: PortalConfig): boolean {
  return request.headers.origin === portalOrigin(config);
}

/** The signed-in agent, or null (unknown, expired or no cookie). */
export async function currentAgent(
  deps: PortalDeps,
  request: FastifyRequest,
): Promise<PortalSession | null> {
  const sessionId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
  if (!sessionId || sessionId.length > 200) return null;
  return deps.repo.getSession(sha256(sessionId, 'hex'));
}

/** Sends 401/403 and returns null unless an agent with one of `roles` is signed in. */
export async function requireAgent(
  deps: PortalDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  roles: readonly PortalRole[] = PORTAL_ROLES,
): Promise<PortalSession | null> {
  const agent = await currentAgent(deps, request);
  if (!agent) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  if (!agent.roles.some((role) => roles.includes(role))) {
    await reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return agent;
}

/**
 * The callback is a browser navigation: failures go back to the portal, which explains them in
 * nl/en and offers to sign in again. No session is created.
 */
function signInFailed(reply: FastifyReply, reason: 'invalid' | 'no_role') {
  return reply.redirect(`/portal/?signin_error=${reason}`, 302);
}

/** Entra ID sign-in (authorization code + PKCE) and the signed-in agent's details. */
export function registerPortalAuthRoutes(app: FastifyInstance, deps: PortalDeps): void {
  const { config } = deps;
  const redirectUri = `${config.baseUrl}/portal/auth/callback`;
  const limited = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.get('/portal/auth/login', limited, async (_request, reply) => {
    const state = random();
    const nonce = random();
    const verifier = random();
    const url = await deps.entra.authUrl({
      redirectUri,
      state,
      nonce,
      codeChallenge: sha256(verifier, 'base64url'),
    });
    const expiresAt = new Date(Date.now() + LOGIN_TTL_SECONDS * 1000);
    // Lax: the cookie must come back on the top-level redirect from Microsoft.
    reply.header(
      'set-cookie',
      serializeCookie(
        LOGIN_COOKIE,
        signValue({ state, nonce, verifier }, config.sessionSecret, expiresAt),
        {
          path: '/portal/auth',
          maxAgeSeconds: LOGIN_TTL_SECONDS,
          sameSite: 'Lax',
        },
      ),
    );
    return reply.redirect(url, 302);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/portal/auth/callback',
    limited,
    async (request, reply) => {
      // Single use: the login cookie is cleared whatever the outcome.
      reply.header(
        'set-cookie',
        serializeCookie(LOGIN_COOKIE, '', {
          path: '/portal/auth',
          maxAgeSeconds: 0,
          sameSite: 'Lax',
        }),
      );
      const saved = loginState.safeParse(
        verifySignedValue(
          parseCookies(request.headers.cookie).get(LOGIN_COOKIE),
          config.sessionSecret,
        ),
      );
      const { code, state } = request.query;
      if (!saved.success || !code || !state || !sameString(state, saved.data.state)) {
        return signInFailed(reply, 'invalid');
      }

      let claims: Awaited<ReturnType<EntraClient['redeem']>>;
      try {
        claims = await deps.entra.redeem({
          code,
          codeVerifier: saved.data.verifier,
          redirectUri,
          expectedNonce: saved.data.nonce,
        });
      } catch (error) {
        request.log.warn({ err: error }, 'portal login: code exchange failed');
        return signInFailed(reply, 'invalid');
      }
      if (
        claims.tid !== config.tenantId ||
        claims.aud !== config.clientId ||
        !claims.oid ||
        !claims.nonce ||
        !sameString(claims.nonce, saved.data.nonce)
      ) {
        return signInFailed(reply, 'invalid');
      }
      const roles = PORTAL_ROLES.filter((role) => claims.roles?.includes(role));
      if (roles.length === 0) return signInFailed(reply, 'no_role');

      const sessionId = random();
      const actor = { oid: claims.oid, name: claims.name ?? claims.oid };
      await deps.repo.createSession({
        idHash: sha256(sessionId, 'hex'),
        userOid: actor.oid,
        displayName: actor.name,
        roles,
        expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      });
      await deps.repo.audit({
        actor,
        action: 'portal.login',
        entityType: 'portal',
        entityId: 'login',
      });
      reply.header('set-cookie', [
        serializeCookie(LOGIN_COOKIE, '', {
          path: '/portal/auth',
          maxAgeSeconds: 0,
          sameSite: 'Lax',
        }),
        serializeCookie(SESSION_COOKIE, sessionId, {
          path: '/portal',
          maxAgeSeconds: SESSION_TTL_SECONDS,
          sameSite: 'Strict',
        }),
      ]);
      return reply.redirect('/portal/', 302);
    },
  );

  app.post('/portal/auth/logout', async (request, reply) => {
    if (!isFromPortal(request, config)) return reply.code(403).send({ error: 'forbidden' });
    const sessionId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (sessionId) await deps.repo.deleteSession(sha256(sessionId, 'hex'));
    reply.header(
      'set-cookie',
      serializeCookie(SESSION_COOKIE, '', {
        path: '/portal',
        maxAgeSeconds: 0,
        sameSite: 'Strict',
      }),
    );
    return reply.code(204).send();
  });

  app.get('/portal/api/me', async (request, reply) => {
    const agent = await requireAgent(deps, request, reply);
    if (!agent) return reply;
    return { name: agent.displayName, roles: agent.roles };
  });
}
