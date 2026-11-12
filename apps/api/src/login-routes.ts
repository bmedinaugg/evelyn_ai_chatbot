import {
  lookupAccounts,
  requestLoginCode,
  selectAccount,
  type VerifyOutcome,
  verifyLoginCode,
} from '@trainmore/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authorizeConversation } from './authorize.ts';
import type { ApiDeps } from './server.ts';

const email = z.string().trim().max(254);
const requestBody = z.object({
  email,
  lang: z.enum(['nl', 'en']),
  turnstileToken: z.string().max(4096),
});
const verifyBody = z.object({ email, code: z.string().trim().max(12) });
const lookupBody = z.object({ email });
const selectBody = z.object({ index: z.number().int().min(0).max(99) });

type Params = { Params: { id: string } };

function sendOutcome(reply: FastifyReply, outcome: VerifyOutcome) {
  switch (outcome.kind) {
    case 'verified':
      return reply.send({ accounts: outcome.accounts, selected: outcome.selected });
    case 'invalid':
      return reply.code(400).send({ error: 'invalid_code' });
    case 'locked':
      return reply.code(400).send({ error: 'locked' });
    case 'expired':
      return reply.code(400).send({ error: 'expired' });
    case 'lookup_failed':
      return reply.code(503).send({ error: 'lookup_failed' });
  }
}

/** Login with an emailed one-time code; the account is bound to the conversation server-side. */
export function registerLoginRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post<Params>(
    '/widget/conversations/:id/login/request',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const conversation = await authorizeConversation(deps.conversations, request, reply);
      if (!conversation) return reply;
      const body = requestBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      if (!(await deps.verifyTurnstile(body.data.turnstileToken, request.ip))) {
        return reply.code(400).send({ error: 'verification_failed' });
      }
      try {
        await requestLoginCode(deps.login, {
          conversationId: conversation.id,
          email: body.data.email,
          lang: body.data.lang,
        });
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request' });
        throw error;
      }
      // Same answer whether or not the email has an account (no enumeration).
      return reply.code(202).send({ ok: true });
    },
  );

  app.post<Params>(
    '/widget/conversations/:id/login/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const conversation = await authorizeConversation(deps.conversations, request, reply);
      if (!conversation) return reply;
      const body = verifyBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      return sendOutcome(
        reply,
        await verifyLoginCode(deps.login, { conversationId: conversation.id, ...body.data }),
      );
    },
  );

  app.post<Params>(
    '/widget/conversations/:id/login/lookup',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const conversation = await authorizeConversation(deps.conversations, request, reply);
      if (!conversation) return reply;
      const body = lookupBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      return sendOutcome(
        reply,
        await lookupAccounts(deps.login, {
          conversationId: conversation.id,
          email: body.data.email,
        }),
      );
    },
  );

  app.post<Params>(
    '/widget/conversations/:id/login/select',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const conversation = await authorizeConversation(deps.conversations, request, reply);
      if (!conversation) return reply;
      const body = selectBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      const account = await selectAccount(deps.login, {
        conversationId: conversation.id,
        index: body.data.index,
      });
      if (!account) return reply.code(400).send({ error: 'invalid_request' });
      return reply.send({ account });
    },
  );
}
