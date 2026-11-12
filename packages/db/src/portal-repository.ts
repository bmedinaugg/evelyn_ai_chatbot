import { z } from 'zod';
import { DbError, type ServiceClient } from './client.ts';
import { FLAG_REASONS, type FlagReason, OUTCOMES, type Outcome } from './conversation-types.ts';

export const PORTAL_ROLES = ['agent', 'approver', 'admin'] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];

export type PortalActor = { oid: string; name: string };
export type PortalSession = { userOid: string; displayName: string; roles: PortalRole[] };
export type AuditAction = 'capability.set' | 'conversation.reveal' | 'portal.login';

export type FlaggedConversation = {
  conversationId: string;
  lang: 'nl' | 'en';
  lastFlagAt: string;
  userMessageCount: number;
  reasons: FlagReason[];
  escalated: boolean;
  loggedIn: boolean;
};

/** What the customer saw and typed, plus review metadata. Text is unmasked: the API masks it. */
export type ConversationDetail = {
  id: string;
  lang: 'nl' | 'en';
  createdAt: string;
  loggedIn: boolean;
  messages: {
    id: number;
    role: 'user' | 'assistant';
    text: string;
    outcome: Outcome | null;
    citations: { articleId: number; title: string; url: string }[];
    createdAt: string;
    rating: 'up' | 'down' | null;
  }[];
  flags: { reason: FlagReason; createdAt: string }[];
  escalations: { topic: string; reason: string; createdAt: string }[];
};

export interface PortalRepository {
  createSession(input: PortalSession & { idHash: string; expiresAt: Date }): Promise<void>;
  /** Null when unknown or expired. */
  getSession(idHash: string): Promise<PortalSession | null>;
  deleteSession(idHash: string): Promise<void>;
  audit(entry: {
    actor: PortalActor;
    action: AuditAction;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
  listFlagged(input: {
    reason?: FlagReason;
    since: Date;
    limit: number;
    offset: number;
  }): Promise<FlaggedConversation[]>;
  /** Null for unknown or anonymised conversations. */
  conversationDetail(id: string): Promise<ConversationDetail | null>;
  listCapabilityFlags(): Promise<{ name: string; enabled: boolean; updatedAt: string }[]>;
  /** Switches a capability and writes the audit row in one transaction. */
  setCapability(name: string, enabled: boolean, actor: PortalActor): Promise<void>;
}

const flaggedRow = z.object({
  conversation_id: z.string(),
  lang: z.enum(['nl', 'en']),
  last_flag_at: z.string(),
  user_message_count: z.number(),
  reasons: z.array(z.enum(FLAG_REASONS)),
  escalated: z.boolean(),
  logged_in: z.boolean(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSupabasePortalRepository(client: ServiceClient): PortalRepository {
  return {
    async createSession(input) {
      const { error } = await client.from('portal_sessions').insert({
        id_hash: input.idHash,
        user_oid: input.userOid,
        display_name: input.displayName,
        roles: input.roles,
        expires_at: input.expiresAt.toISOString(),
      });
      if (error) throw new DbError('portal_sessions insert', error.code);
    },

    async getSession(idHash) {
      const { data, error } = await client
        .from('portal_sessions')
        .select('user_oid, display_name, roles')
        .eq('id_hash', idHash)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (error) throw new DbError('portal_sessions select', error.code);
      if (!data) return null;
      const row = z
        .object({
          user_oid: z.string(),
          display_name: z.string(),
          roles: z.array(z.enum(PORTAL_ROLES)),
        })
        .parse(data);
      return { userOid: row.user_oid, displayName: row.display_name, roles: row.roles };
    },

    async deleteSession(idHash) {
      const { error } = await client.from('portal_sessions').delete().eq('id_hash', idHash);
      if (error) throw new DbError('portal_sessions delete', error.code);
    },

    async audit(entry) {
      const { error } = await client.from('audit_log').insert({
        actor: entry.actor.oid,
        actor_name: entry.actor.name,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        details: JSON.parse(JSON.stringify(entry.details ?? {})),
      });
      if (error) throw new DbError('audit_log insert', error.code);
    },

    async listFlagged(input) {
      const { data, error } = await client.rpc('list_flagged_conversations', {
        // The generated type omits null; null means "any reason".
        p_reason: (input.reason ?? null) as string,
        p_since: input.since.toISOString(),
        p_limit: input.limit,
        p_offset: input.offset,
      });
      if (error) throw new DbError('list_flagged_conversations', error.code);
      return z
        .array(flaggedRow)
        .parse(data ?? [])
        .map((row) => ({
          conversationId: row.conversation_id,
          lang: row.lang,
          lastFlagAt: row.last_flag_at,
          userMessageCount: row.user_message_count,
          reasons: row.reasons,
          escalated: row.escalated,
          loggedIn: row.logged_in,
        }));
    },

    async conversationDetail(id) {
      if (!UUID.test(id)) return null;
      const conversation = await client
        .from('conversations')
        .select('id, lang, created_at, verified_email_hash, anonymised_at')
        .eq('id', id)
        .maybeSingle();
      if (conversation.error) throw new DbError('conversations select', conversation.error.code);
      if (!conversation.data || conversation.data.anonymised_at !== null) return null;

      const [messages, flags, escalations] = await Promise.all([
        client
          .from('messages')
          .select(
            'id, role, display_text, outcome, citations, created_at, message_feedback(rating)',
          )
          .eq('conversation_id', id)
          .neq('display_text', '')
          .order('id', { ascending: true })
          .limit(200),
        client
          .from('flags')
          .select('reason, created_at')
          .eq('conversation_id', id)
          .order('created_at', { ascending: true }),
        client
          .from('escalations')
          .select('topic, reason, created_at')
          .eq('conversation_id', id)
          .order('created_at', { ascending: true }),
      ]);
      for (const result of [messages, flags, escalations]) {
        if (result.error) throw new DbError('conversation detail select', result.error.code);
      }

      const messageRows = z
        .array(
          z.object({
            id: z.number(),
            role: z.enum(['user', 'assistant']),
            display_text: z.string(),
            outcome: z.enum(OUTCOMES).nullable(),
            citations: z
              .array(z.object({ articleId: z.number(), title: z.string(), url: z.string() }))
              .catch([]),
            created_at: z.string(),
            message_feedback: z
              .union([
                z.object({ rating: z.enum(['up', 'down']) }),
                z.array(z.object({ rating: z.enum(['up', 'down']) })),
              ])
              .nullable(),
          }),
        )
        .parse(messages.data ?? []);

      return {
        id: conversation.data.id,
        lang: z.enum(['nl', 'en']).parse(conversation.data.lang),
        createdAt: conversation.data.created_at,
        loggedIn: conversation.data.verified_email_hash !== null,
        messages: messageRows.map((m) => {
          const feedback = Array.isArray(m.message_feedback)
            ? m.message_feedback[0]
            : m.message_feedback;
          return {
            id: m.id,
            role: m.role,
            text: m.display_text,
            outcome: m.outcome,
            citations: m.citations,
            createdAt: m.created_at,
            rating: feedback?.rating ?? null,
          };
        }),
        flags: z
          .array(z.object({ reason: z.enum(FLAG_REASONS), created_at: z.string() }))
          .parse(flags.data ?? [])
          .map((f) => ({ reason: f.reason, createdAt: f.created_at })),
        escalations: z
          .array(z.object({ topic: z.string(), reason: z.string(), created_at: z.string() }))
          .parse(escalations.data ?? [])
          .map((e) => ({ topic: e.topic, reason: e.reason, createdAt: e.created_at })),
      };
    },

    async listCapabilityFlags() {
      const { data, error } = await client
        .from('capability_flags')
        .select('name, enabled, updated_at')
        .order('name');
      if (error) throw new DbError('capability_flags select', error.code);
      return (data ?? []).map((row) => ({
        name: row.name,
        enabled: row.enabled,
        updatedAt: row.updated_at,
      }));
    },

    async setCapability(name, enabled, actor) {
      const { error } = await client.rpc('set_capability', {
        p_name: name,
        p_enabled: enabled,
        p_actor_oid: actor.oid,
        p_actor_name: actor.name,
      });
      if (error) throw new DbError('set_capability', error.code);
    },
  };
}
