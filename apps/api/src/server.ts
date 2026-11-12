import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { type Answerer, answerMessage, ConversationBusyError } from '@trainmore/core';
import type { ConversationRepository, FaqRepository } from '@trainmore/db';
import type { FreshdeskClient } from '@trainmore/freshdesk';
import type { Logger } from '@trainmore/shared';
import Fastify, { type FastifyError } from 'fastify';
import { z } from 'zod';
import { newConversationToken, tokenMatches } from './conversation-token.ts';
import { registerLeadRoutes } from './leads.ts';

export type ApiDeps = {
  conversations: ConversationRepository;
  faq: FaqRepository;
  answerer: Answerer;
  freshdesk: Pick<FreshdeskClient, 'createTicket'>;
  verifyTurnstile: (token: string, remoteIp: string) => Promise<boolean>;
  config: { allowedOrigins: string[]; supportContactUrl: string };
  logger: Logger;
};

const langSchema = z.enum(['nl', 'en']);
const createConversationBody = z.object({ lang: langSchema });
const messageBody = z.object({ text: z.string().trim().min(1).max(1000), pageLang: langSchema });
const BEARER = /^Bearer (\S+)$/;

export type ApiServer = ReturnType<typeof buildApiServer>;

export function buildApiServer(deps: ApiDeps) {
  const app = Fastify({ loggerInstance: deps.logger, bodyLimit: 16 * 1024 });

  // Browsers always send Origin on cross-site POSTs: anything not on the allowlist is refused.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && !deps.config.allowedOrigins.includes(origin)) {
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
        const bearer = BEARER.exec(request.headers.authorization ?? '')?.[1];
        if (!bearer) return reply.code(401).send({ error: 'unauthorized' });
        const conversation = await deps.conversations.get(request.params.id);
        // Same answer for "no such conversation" and "wrong token".
        if (!conversation || !tokenMatches(bearer, conversation.tokenHash)) {
          return reply.code(404).send({ error: 'not_found' });
        }
        const body = messageBody.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_request' });

        try {
          const result = await answerMessage(
            {
              faq: deps.faq,
              conversations: deps.conversations,
              answerer: deps.answerer,
              logger: deps.logger,
            },
            { conversationId: conversation.id, text: body.data.text, pageLang: body.data.pageLang },
          );
          return {
            reply: {
              text: result.text,
              lang: result.lang,
              citations: result.citations,
              action: result.action,
              ...(result.action === 'contact' ? { contactUrl: deps.config.supportContactUrl } : {}),
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
  });

  return app;
}
