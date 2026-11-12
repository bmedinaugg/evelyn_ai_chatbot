import type { Lang } from '@trainmore/i18n';
import { z } from 'zod';
import { DbError, type ServiceClient } from './client.ts';
import {
  type ApiHistoryEntry,
  ClaimLostError,
  type ConversationRepository,
  OUTCOMES,
  type StoredMessage,
} from './conversation-types.ts';
import type { Json } from './generated/database.types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const conversationRowSchema = z.object({
  id: z.string(),
  token_hash: z.string(),
  lang: z.enum(['nl', 'en']),
  user_message_count: z.number().int(),
});

const historyRowSchema = z.object({
  role: z.enum(['user', 'assistant']),
  api_content: z.unknown(),
});

function toJson(message: StoredMessage): Json {
  // Round-trip through JSON so stored content is exactly what JSON serialisation sends to the API.
  return JSON.parse(
    JSON.stringify({
      display_text: message.displayText,
      api_content: message.apiContent,
      outcome: message.outcome ?? null,
      citations: message.citations ?? [],
    }),
  ) as Json;
}

export function createSupabaseConversationRepository(
  client: ServiceClient,
): ConversationRepository {
  return {
    async create(input: { tokenHash: string; lang: Lang }) {
      const { data, error } = await client
        .from('conversations')
        .insert({ token_hash: input.tokenHash, lang: input.lang })
        .select('id')
        .single();
      if (error) throw new DbError('conversations insert', error.code);
      return { id: data.id };
    },

    async get(id) {
      if (!UUID.test(id)) return null;
      const { data, error } = await client
        .from('conversations')
        .select('id, token_hash, lang, user_message_count')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new DbError('conversations select', error.code);
      if (!data) return null;
      const row = conversationRowSchema.parse(data);
      return {
        id: row.id,
        tokenHash: row.token_hash,
        lang: row.lang,
        userMessageCount: row.user_message_count,
      };
    },

    async claimTurn(id) {
      const { data, error } = await client.rpc('claim_conversation_turn', { p_id: id });
      if (error) throw new DbError('claim_conversation_turn', error.code);
      return z.uuid().nullable().parse(data);
    },

    async releaseTurn(id, claimId) {
      const { error } = await client.rpc('release_conversation_turn', {
        p_id: id,
        p_claim_id: claimId,
      });
      if (error) throw new DbError('release_conversation_turn', error.code);
    },

    async listApiHistory(id): Promise<ApiHistoryEntry[]> {
      const { data, error } = await client
        .from('messages')
        .select('role, api_content')
        .eq('conversation_id', id)
        .order('id');
      if (error) throw new DbError('messages select', error.code);
      return z
        .array(historyRowSchema)
        .parse(data)
        .map((row) => ({ role: row.role, content: row.api_content }));
    },

    async lastAssistantOutcome(id) {
      const { data, error } = await client
        .from('messages')
        .select('outcome')
        .eq('conversation_id', id)
        .eq('role', 'assistant')
        .neq('display_text', '')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new DbError('messages outcome select', error.code);
      return z
        .enum(OUTCOMES)
        .nullable()
        .parse(data?.outcome ?? null);
    },

    async listTranscript(id) {
      const { data, error } = await client
        .from('messages')
        .select('role, display_text')
        .eq('conversation_id', id)
        .neq('display_text', '')
        .order('id', { ascending: false })
        .limit(50);
      if (error) throw new DbError('messages transcript select', error.code);
      return z
        .array(z.object({ role: z.enum(['user', 'assistant']), display_text: z.string() }))
        .parse(data)
        .reverse()
        .map((row) => ({ role: row.role, text: row.display_text }));
    },

    async appendTurn(input) {
      const { data, error } = await client.rpc('append_chat_turn', {
        p_conversation_id: input.conversationId,
        p_claim_id: input.claimId,
        p_user: toJson(input.user),
        // null is a valid p_assistant (no assistant message); the generated type omits it.
        p_assistant: (input.assistant ? toJson(input.assistant) : null) as Json,
        p_flags: input.flags,
        p_steps: JSON.parse(
          JSON.stringify(
            (input.steps ?? []).map((step) => ({ role: step.role, api_content: step.content })),
          ),
        ) as Json,
      });
      if (error?.code === 'TM001') throw new ClaimLostError();
      if (error) throw new DbError('append_chat_turn', error.code);
      return typeof data === 'number' ? data : null;
    },

    async recordFeedback(conversationId, messageId, rating) {
      const { data, error } = await client.rpc('record_feedback', {
        p_conversation_id: conversationId,
        p_message_id: messageId,
        p_rating: rating,
      });
      if (error) throw new DbError('record_feedback', error.code);
      return data === true;
    },

    async recordLead(input) {
      const { error } = await client.from('lead_submissions').insert({
        conversation_id: input.conversationId,
        freshdesk_ticket_id: input.freshdeskTicketId,
        lang: input.lang,
      });
      if (error) throw new DbError('lead_submissions insert', error.code);
    },
  };
}
