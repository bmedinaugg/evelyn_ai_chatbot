import {
  ClaimLostError,
  type ConversationRepository,
  type FaqRepository,
  type FlagReason,
  type StoredMessage,
} from '@trainmore/db';
import { type Lang, t } from '@trainmore/i18n';
import type { Logger } from '@trainmore/shared';
import type { Answerer, AnswererResult } from './claude-answerer.ts';
import { finalizeReply, type Reply } from './finalize-reply.ts';
import { buildUserTurn } from './prompt.ts';

export const MAX_CUSTOMER_MESSAGES = 20;
const SEARCH_LIMIT = 5;

export class ConversationBusyError extends Error {
  constructor() {
    super('Another message in this conversation is still being answered');
    this.name = 'ConversationBusyError';
  }
}

export type AnswerMessageDeps = {
  faq: FaqRepository;
  conversations: ConversationRepository;
  answerer: Answerer;
  logger: Logger;
};

function fixedReply(
  lang: Lang,
  key: 'bot.noMatch' | 'bot.error' | 'bot.conversationLimit',
  overrides: Partial<Reply>,
): Reply {
  return {
    text: t(lang, key),
    lang,
    citations: [],
    action: 'none',
    outcome: 'error',
    flags: [],
    ...overrides,
  };
}

/**
 * Answers one customer message: claim the turn, retrieve FAQ articles, ask Claude, apply the
 * guardrails, and append the turn. Errors become a generic reply; the customer text is never logged.
 */
export async function answerMessage(
  deps: AnswerMessageDeps,
  input: { conversationId: string; text: string; pageLang: Lang },
): Promise<Reply> {
  const { conversations, logger } = deps;
  const claimId = await conversations.claimTurn(input.conversationId);
  if (!claimId) throw new ConversationBusyError();

  let appended = false;
  try {
    const conversation = await conversations.get(input.conversationId);
    if (!conversation) throw new Error('conversation disappeared during turn');
    if (conversation.userMessageCount >= MAX_CUSTOMER_MESSAGES) {
      return fixedReply(input.pageLang, 'bot.conversationLimit', { outcome: 'limit' });
    }

    const hits = await deps.faq.search(input.text, input.pageLang, SEARCH_LIMIT);
    const userTurn = buildUserTurn({
      customerMessage: input.text,
      articles: hits,
      pageLang: input.pageLang,
    });

    let result: AnswererResult | { kind: 'error' };
    try {
      result = await deps.answerer({
        history: await conversations.listApiHistory(input.conversationId),
        userTurn,
      });
    } catch (error) {
      logger.error({ err: error, conversationId: input.conversationId }, 'answerer failed');
      result = { kind: 'error' };
    }

    const reply: Reply =
      result.kind === 'answer'
        ? finalizeReply({ answer: result.answer, hits })
        : result.kind === 'refusal'
          ? fixedReply(input.pageLang, 'bot.noMatch', {
              action: 'contact',
              outcome: 'refusal',
              flags: ['refusal'],
            })
          : fixedReply(input.pageLang, 'bot.error', {
              outcome: 'error',
              flags: ['error'] satisfies FlagReason[],
            });

    const user: StoredMessage = { displayText: input.text, apiContent: userTurn };
    const assistant: StoredMessage | null =
      result.kind === 'answer'
        ? {
            displayText: reply.text,
            apiContent: result.assistantContent,
            outcome: reply.outcome,
            citations: reply.citations,
          }
        : null;
    try {
      await conversations.appendTurn({
        conversationId: input.conversationId,
        claimId,
        user,
        assistant,
        flags: reply.flags,
      });
    } catch (error) {
      // A newer request took over after our claim expired: drop this result instead of forking history.
      if (error instanceof ClaimLostError) throw new ConversationBusyError();
      throw error;
    }
    appended = true;

    logger.info(
      {
        conversationId: input.conversationId,
        outcome: reply.outcome,
        hits: hits.length,
        flags: reply.flags,
      },
      'message answered',
    );
    return reply;
  } finally {
    if (!appended) await conversations.releaseTurn(input.conversationId, claimId);
  }
}
