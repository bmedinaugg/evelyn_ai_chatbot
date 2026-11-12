import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  type Answerer,
  type AnswerMessageDeps,
  answerMessage,
  ConversationBusyError,
  type LoginDeps,
} from '@trainmore/core';
import type { ConversationRepository, EscalationRepository, FaqRepository } from '@trainmore/db';
import type { FreshdeskClient } from '@trainmore/freshdesk';
import type { Logger } from '@trainmore/shared';
import Fastify, { type FastifyError } from 'fastify';
import { z } from 'zod';
import { authorizeConversation } from './authorize.ts';
import { newConversationToken } from './conversation-token.ts';
import { registerFeedbackRoutes } from './feedback.ts';
import { registerLeadRoutes } from './leads.ts';
import { registerLoginRoutes } from './login-routes.ts';
import { type PortalDeps, portalOrigin, registerPortalAuthRoutes } from './portal/auth.ts';
import { registerPortalReviewRoutes } from './portal/review.ts';
import { proxyTrust } from './proxy-trust.ts';
import { registerTicketRoutes } from './tickets.ts';

export type ApiDeps = {
  login: LoginDeps;
  /** Account tools for logged-in customers (bound account). */
  capabilities?: AnswerMessageDeps['capabilities'];
  /** Published approved answers (scenarios). */
  scenarios?: AnswerMessageDeps['scenarios'];
  conversations: ConversationRepository;
  faq: FaqRepository;
  answerer: Answerer;
  freshdesk: Pick<FreshdeskClient, 'createTicket' | 'addPrivateNote'>;
  escalations: Pick<EscalationRepository, 'activeTopics' | 'record'>;
  verifyTurnstile: (token: string, remoteIp: string) => Promise<boolean>;
  config: {
    allowedOrigins: string[];
    supportContactUrl: string;
    /** Proxies in front of the API (CloudFront + ALB = 2); 0 when exposed directly. */
    trustProxyHops: number;
    /** Extra Freshdesk tag on tickets and leads outside production, e.g. `chatbot-preprod`. */
    envTag?: string;
  };
  logger: Logger;
  /** Agent portal (Entra ID); absent until it is configured. */
  portal?: PortalDeps;
};

const langSchema = z.enum(['nl', 'en']);
const createConversationBody = z.object({ lang: langSchema });
const messageBody = z.object({ text: z.string().trim().min(1).max(1000), pageLang: langSchema });

export type ApiServer = ReturnType<typeof buildApiServer>;

export function buildApiServer(deps: ApiDeps) {
  const app = Fastify({
    loggerInstance: deps.logger,
    bodyLimit: 16 * 1024,
    // request.ip must be the visitor (rate limits, Turnstile): trust exactly our own proxy hops.
    ...(deps.config.trustProxyHops > 0
      ? { trustProxy: proxyTrust(deps.config.trustProxyHops) }
      : {}),
  });

  // Browsers always send Origin on cross-site POSTs: anything not on the allowlist is refused.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      !deps.config.allowedOrigins.includes(origin) &&
      !(deps.portal && origin === portalOrigin(deps.portal.config))
    ) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  });
  app.register(cors, { origin: deps.config.allowedOrigins, methods: ['GET', 'POST'] });
  app.register(rateLimit, { global: false });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited' });
    if (status === 413) return reply.code(413).send({ error: 'too_large' });
    if (status >= 400 && status < 500) return reply.code(400).send({ error: 'invalid_request' });
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/health', async () => ({ ok: true }));

  app.register(async (widget) => {
    widget.post(
      '/widget/conversations',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const body = createConversationBody.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
        const { token, tokenHash } = newConversationToken();
        const { id } = await deps.conversations.create({ tokenHash, lang: body.data.lang });
        return reply.code(201).send({ conversationId: id, token });
      },
    );

    widget.post<{ Params: { id: string } }>(
      '/widget/conversations/:id/messages',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const conversation = await authorizeConversation(deps.conversations, request, reply);
        if (!conversation) return reply;
        const body = messageBody.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_request' });

        try {
          const result = await answerMessage(
            {
              faq: deps.faq,
              conversations: deps.conversations,
              answerer: deps.answerer,
              logger: deps.logger,
              ...(deps.capabilities ? { capabilities: deps.capabilities } : {}),
              ...(deps.scenarios ? { scenarios: deps.scenarios } : {}),
            },
            {
              conversationId: conversation.id,
              text: body.data.text,
              pageLang: body.data.pageLang,
              account: (await deps.login.auth.getAuthState(conversation.id)).account,
            },
          );
          return {
            reply: {
              text: result.text,
              lang: result.lang,
              citations: result.citations,
              action: result.action,
              ...(result.action === 'ticket_form'
                ? { contactUrl: deps.config.supportContactUrl }
                : {}),
              ...(result.messageId === null ? {} : { messageId: result.messageId }),
            },
          };
        } catch (error) {
          if (error instanceof ConversationBusyError)
            return reply.code(409).send({ error: 'busy' });
          throw error;
        }
      },
    );

    registerLeadRoutes(widget, deps);
    registerLoginRoutes(widget, deps);
    registerTicketRoutes(widget, deps);
    registerFeedbackRoutes(widget, deps);
  });

  const { portal } = deps;
  if (portal) {
    app.register(async (scope) => {
      registerPortalAuthRoutes(scope, portal);
      registerPortalReviewRoutes(scope, portal);
    });
  }

  return app;
}
