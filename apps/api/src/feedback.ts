import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeConversation } from './authorize.ts';
import type { ApiDeps } from './server.ts';

const feedbackBody = z.object({
  messageId: z.number().int().positive(),
  rating: z.enum(['up', 'down']),
});

/** Thumbs up/down on a bot reply of this conversation; a thumbs down flags it for review. */
export function registerFeedbackRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post<{ Params: { id: string } }>(
    '/widget/conversations/:id/feedback',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const conversation = await authorizeConversation(deps.conversations, request, reply);
      if (!conversation) return reply;
      const body = feedbackBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      const recorded = await deps.conversations.recordFeedback(
        conversation.id,
        body.data.messageId,
        body.data.rating,
      );
      // Same answer for any message that is not a reply of this conversation (no probing).
      if (!recorded) return reply.code(404).send({ error: 'not_found' });
      deps.logger.info({ conversationId: conversation.id, rating: body.data.rating }, 'feedback');
      return reply.code(204).send();
    },
  );
}
