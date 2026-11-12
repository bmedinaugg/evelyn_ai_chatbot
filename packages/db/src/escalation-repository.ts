import { z } from 'zod';
import { DbError, type ServiceClient } from './client.ts';

export type EscalationReason = 'customer_request' | 'stuck';

export interface EscalationRepository {
  activeTopics(): Promise<string[]>;
  /** Replaces the active topics (refused by the database when empty). */
  replaceTopics(values: string[]): Promise<void>;
  record(input: {
    conversationId: string | null;
    freshdeskTicketId: number;
    topic: string;
    reason: EscalationReason;
  }): Promise<void>;
}

export function createSupabaseEscalationRepository(client: ServiceClient): EscalationRepository {
  return {
    async activeTopics() {
      const { data, error } = await client
        .from('ticket_topics')
        .select('value')
        .eq('active', true)
        .order('value');
      if (error) throw new DbError('ticket_topics select', error.code);
      return z
        .array(z.object({ value: z.string() }))
        .parse(data)
        .map((row) => row.value);
    },

    async replaceTopics(values) {
      const { error } = await client.rpc('replace_ticket_topics', { p_values: values });
      if (error) throw new DbError('replace_ticket_topics', error.code);
    },

    async record(input) {
      const { error } = await client.from('escalations').insert({
        conversation_id: input.conversationId,
        freshdesk_ticket_id: input.freshdeskTicketId,
        topic: input.topic,
        reason: input.reason,
      });
      if (error) throw new DbError('escalations insert', error.code);
    },
  };
}
