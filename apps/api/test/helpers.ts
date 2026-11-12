import { Writable } from 'node:stream';
import type { Answerer, AnswererResult, Reply } from '@trainmore/core';
import type {
  ConversationRecord,
  ConversationRepository,
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
  } = {},
) {
  const conversations = new Map<
    string,
    ConversationRecord & { turns: StoredMessage[]; claimed: boolean }
  >();
  const leads: { conversationId: string | null; freshdeskTicketId: number; lang: string }[] = [];
  const tickets: CreateTicketInput[] = [];
  const answererCalls: Parameters<Answerer>[0][] = [];
  const turnstileIps: string[] = [];
  let logOutput = '';
  let counter = 0;

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
      if (!c) return;
      c.turns.push(input.user);
      if (input.assistant) c.turns.push(input.assistant);
      c.userMessageCount += 1;
      c.claimed = false;
    },
    async recordLead(input) {
      if (options.recordLeadError === 'always') throw new Error('db down');
      if (options.recordLeadError === 'with-conversation' && input.conversationId !== null) {
        throw new Error('foreign key violation');
      }
      leads.push(input);
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
    };
    if (result instanceof Error) throw result;
    return result;
  };

  const deps: ApiDeps = {
    conversations: conversationRepo,
    faq,
    answerer,
    freshdesk: {
      async createTicket(input) {
        if (options.ticketError) throw options.ticketError;
        tickets.push(input);
        return { id: 777 };
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
    conversations,
    leads,
    tickets,
    answererCalls,
    turnstileIps,
    logs: () => logOutput,
  };
}

export type { Reply };
