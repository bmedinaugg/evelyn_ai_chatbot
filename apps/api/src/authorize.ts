import type { ConversationRecord, ConversationRepository } from '@trainmore/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { tokenMatches } from './conversation-token.ts';

const BEARER = /^Bearer (\S+)$/;

/**
 * Checks the conversation bearer token. Sends 401 (no token) or 404 (unknown conversation or wrong
 * token, deliberately indistinguishable) and returns null; otherwise returns the conversation.
 */
export async function authorizeConversation(
  conversations: ConversationRepository,
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<ConversationRecord | null> {
  const bearer = BEARER.exec(request.headers.authorization ?? '')?.[1];
  if (!bearer) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  const conversation = await conversations.get(request.params.id);
  if (!conversation || !tokenMatches(bearer, conversation.tokenHash)) {
    await reply.code(404).send({ error: 'not_found' });
    return null;
  }
  return conversation;
}
