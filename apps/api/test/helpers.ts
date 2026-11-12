import { Writable } from 'node:stream';
import type { Answerer, AnswererResult, LoginDeps, Reply } from '@trainmore/core';
import type {
  AccountCandidate,
  AuthRepository,
  AuthState,
  ConversationRecord,
  ConversationRepository,
  EscalationRepository,
  FaqRepository,
  StoredMessage,
} from '@trainmore/db';
import type { CreateTicketInput } from '@trainmore/freshdesk';
import { createLogger } from '@trainmore/shared';
import { type ApiDeps, buildApiServer } from '../src/server.ts';

export const ORIGIN = 'https://www.support.trainmore.com';
export const CONTACT_URL = 'https://www.support.trainmore.com/en/support/tickets/new';

export function createTestApi(
  options: {
    answer?: AnswererResult | Error;
    turnstileOk?: boolean;
    ticketError?: Error;
    claimError?: Error;
    trustProxyHops?: number;
    recordLeadError?: 'with-conversation' | 'always';
    accounts?: {
      customerId: number;
      studioId: number;
      status: 'MEMBER' | 'PROSPECT' | 'FORMER_MEMBER';
      customerNumber: string | null;
    }[];
    magiclineDown?: boolean;
    /** Synced Freshdesk topics (empty: built-in defaults apply). */
    topics?: string[];
    topicsError?: boolean;
    noteError?: Error;
  } = {},
) {
  const conversations = new Map<
    string,
    ConversationRecord & { turns: StoredMessage[]; claimed: boolean }
  >();
  const leads: { conversationId: string | null; freshdeskTicketId: number; lang: string }[] = [];
  const tickets: CreateTicketInput[] = [];
  const notes: { ticketId: number; text: string }[] = [];
  const escalations: Parameters<EscalationRepository['record']>[0][] = [];
  const answererCalls: Parameters<Answerer>[0][] = [];
  const turnstileIps: string[] = [];
  let logOutput = '';
  let counter = 0;
  let messageIds = 0;
  const replies = new Map<number, string>();
  const feedback: { conversationId: string; messageId: number; rating: 'up' | 'down' }[] = [];

  const conversationRepo: ConversationRepository = {
    async create(input) {
      counter += 1;
      const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      conversations.set(id, {
        id,
        tokenHash: input.tokenHash,
        lang: input.lang,
        userMessageCount: 0,
        turns: [],
        claimed: false,
      });
      return { id };
    },
    async get(id) {
      const c = conversations.get(id);
      return c
        ? { id: c.id, tokenHash: c.tokenHash, lang: c.lang, userMessageCount: c.userMessageCount }
        : null;
    },
    async claimTurn(id) {
      if (options.claimError) throw options.claimError;
      const c = conversations.get(id);
      if (!c || c.claimed) return null;
      c.claimed = true;
      return 'claim-1';
    },
    async releaseTurn(id) {
      const c = conversations.get(id);
      if (c) c.claimed = false;
    },
    async listApiHistory() {
      return [];
    },
    async appendTurn(input) {
      const c = conversations.get(input.conversationId);
      if (!c) return null;
      c.turns.push(input.user);
      if (input.assistant) c.turns.push(input.assistant);
      c.userMessageCount += 1;
      c.claimed = false;
      if (!input.assistant) return null;
      messageIds += 1;
      replies.set(messageIds, input.conversationId);
      return messageIds;
    },
    async recordFeedback(conversationId, messageId, rating) {
      if (replies.get(messageId) !== conversationId) return false;
      feedback.push({ conversationId, messageId, rating });
      return true;
    },
    async recordLead(input) {
      if (options.recordLeadError === 'always') throw new Error('db down');
      if (options.recordLeadError === 'with-conversation' && input.conversationId !== null) {
        throw new Error('foreign key violation');
      }
      leads.push(input);
    },
    async lastAssistantOutcome(id) {
      const turns = conversations.get(id)?.turns ?? [];
      return turns.findLast((m) => m.outcome !== undefined)?.outcome ?? null;
    },
    async listTranscript(id) {
      return (conversations.get(id)?.turns ?? []).map((m) => ({
        role: m.outcome === undefined ? ('user' as const) : ('assistant' as const),
        text: m.displayText,
      }));
    },
  };

  const faq: FaqRepository = {
    async getActiveSummaries() {
      return [];
    },
    async getActiveContentHashes() {
      return new Map();
    },
    async countActive() {
      return 0;
    },
    async upsert() {},
    async softDeleteAllExcept() {
      return 0;
    },
    async search() {
      return [];
    },
  };

  const answerer: Answerer = async (input) => {
    answererCalls.push(input);
    const result = options.answer ?? {
      kind: 'answer',
      answer: {
        language: 'en',
        intent: 'wants_human',
        answer: 'x',
        citedArticleIds: [],
        confidence: 'high',
        needsHuman: true,
      },
      assistantContent: [],
      steps: [],
      toolsUsed: [],
    };
    if (result instanceof Error) throw result;
    return result;
  };

  // In-memory auth repository with the same rules as the SQL functions.
  const sentCodes: { to: string; code: string }[] = [];
  const challenges: {
    id: string;
    conversationId: string;
    emailHash: string;
    codeHash: string;
    attempts: number;
    consumed: boolean;
  }[] = [];
  const authByConversation = new Map<
    string,
    { emailHash: string | null; candidates: AccountCandidate[] | null; bound: number | null }
  >();
  const authOf = (id: string) => {
    const existing = authByConversation.get(id);
    if (existing) return existing;
    const created = { emailHash: null, candidates: null, bound: null };
    authByConversation.set(id, created);
    return created;
  };
  const authRepo: AuthRepository = {
    async createOtpChallenge(input) {
      if (challenges.filter((c) => c.emailHash === input.emailHash).length >= input.maxPerWindow)
        return false;
      challenges.push({ ...input, attempts: 0, consumed: false });
      return true;
    },
    async latestOpenChallengeId(conversationId, emailHash) {
      return (
        challenges
          .filter(
            (c) => c.conversationId === conversationId && c.emailHash === emailHash && !c.consumed,
          )
          .at(-1)?.id ?? null
      );
    },
    async verifyOtpAttempt({ challengeId, conversationId, codeHash, maxAttempts }) {
      const c = challenges.find((x) => x.id === challengeId && x.conversationId === conversationId);
      if (!c || c.consumed) return 'not_found';
      if (c.attempts >= maxAttempts) return 'locked';
      if (c.codeHash === codeHash) {
        c.consumed = true;
        // Mirrors verify_otp_attempt: a new login replaces any earlier binding.
        authByConversation.set(conversationId, {
          emailHash: c.emailHash,
          candidates: null,
          bound: null,
        });
        return 'ok';
      }
      c.attempts += 1;
      return c.attempts >= maxAttempts ? 'locked' : 'invalid';
    },
    async setAccountCandidates(id, candidates) {
      authOf(id).candidates = candidates;
    },
    async bindAccount(id, index) {
      const a = authOf(id);
      if (!a.emailHash || !a.candidates?.[index] || a.bound !== null) return false;
      a.bound = index;
      return true;
    },
    async getAuthState(id): Promise<AuthState> {
      const a = authOf(id);
      const c = a.bound === null ? null : a.candidates?.[a.bound];
      return {
        verified: a.emailHash !== null,
        verifiedEmailHash: a.emailHash,
        candidates: a.candidates,
        account: c ? { customerId: c.customerId, studioId: c.studioId, status: c.status } : null,
      };
    },
  };
  const login: LoginDeps = {
    auth: authRepo,
    email: {
      async sendLoginCode(message) {
        sentCodes.push({ to: message.to, code: message.code });
      },
    },
    magicline: {
      async searchByEmail() {
        if (options.magiclineDown) throw new Error('Magicline 503');
        return (
          options.accounts ?? [
            { customerId: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' },
          ]
        );
      },
      async studioName(studioId) {
        return `Club ${studioId}`;
      },
    },
    config: {
      secret: 's'.repeat(32),
      ttlSeconds: 300,
      maxAttempts: 5,
      maxPerWindow: 3,
      windowSeconds: 900,
    },
    logger: createLogger({
      name: 'login-test',
      level: 'info',
      destination: new Writable({
        write(chunk, _encoding, callback) {
          logOutput += chunk.toString();
          callback();
        },
      }),
    }),
  };

  const deps: ApiDeps = {
    login,
    capabilities: {
      deps: {
        studioClient: async () => ({ getContracts: async () => [{ rateName: 'Flex' }] }) as never, // only contracts are used in API tests
        crossStudioClient: async () => ({}) as never,
        today: () => new Date('2026-11-12T10:00:00Z'),
      },
      disabled: async () => new Set<string>(),
    },
    conversations: conversationRepo,
    faq,
    answerer,
    freshdesk: {
      async createTicket(input) {
        if (options.ticketError) throw options.ticketError;
        tickets.push(input);
        return { id: 777 };
      },
      async addPrivateNote(ticketId, text) {
        if (options.noteError) throw options.noteError;
        notes.push({ ticketId, text });
      },
    },
    escalations: {
      async activeTopics() {
        if (options.topicsError) throw new Error('db down');
        return options.topics ?? [];
      },
      async record(input) {
        escalations.push(input);
      },
    },
    verifyTurnstile: async (_token, remoteIp) => {
      turnstileIps.push(remoteIp);
      return options.turnstileOk ?? true;
    },
    config: {
      allowedOrigins: [ORIGIN],
      supportContactUrl: CONTACT_URL,
      trustProxyHops: options.trustProxyHops ?? 0,
    },
    logger: createLogger({
      name: 'api-test',
      level: 'info',
      destination: new Writable({
        write(chunk, _encoding, callback) {
          logOutput += chunk.toString();
          callback();
        },
      }),
    }),
  };

  return {
    app: buildApiServer(deps),
    sentCodes,
    authState: (id: string) => authRepo.getAuthState(id),
    conversations,
    leads,
    tickets,
    notes,
    escalations,
    feedback,
    answererCalls,
    turnstileIps,
    logs: () => logOutput,
  };
}

export type { Reply };
