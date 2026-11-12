import {
  type ApiHistoryEntry,
  ClaimLostError,
  type ConversationRepository,
  type FaqRepository,
  type FlagReason,
  type Outcome,
  type StoredMessage,
} from '@trainmore/db';
import { type Lang, t } from '@trainmore/i18n';
import type { Logger } from '@trainmore/shared';
import {
  type AccountContext,
  availableCapabilities,
  CAPABILITIES,
  type CapabilityDeps,
  runCapability,
  toolDefinitions,
} from './capabilities/catalogue.ts';
import type { Answerer, AnswererResult, AnswererTools } from './claude-answerer.ts';
import { finalizeReply, type Reply } from './finalize-reply.ts';
import { buildUserTurn } from './prompt.ts';

export const MAX_CUSTOMER_MESSAGES = 20;
const SEARCH_LIMIT = 5;
/** Replies where the bot could not help; two in a row means the conversation is stuck. */
const FAILED: ReadonlySet<Outcome> = new Set(['no_match', 'invalid_citation']);

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
  /** Account tools (needs a bound account to be offered). */
  capabilities?: { deps: CapabilityDeps; disabled(): Promise<ReadonlySet<string>> };
};

function fixedReply(
  lang: Lang,
  key: 'bot.noMatch' | 'bot.error' | 'bot.conversationLimit' | 'bot.stuck',
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
  input: {
    conversationId: string;
    text: string;
    pageLang: Lang;
    /** The account bound to this conversation (server-side), if the customer logged in. */
    account?: AccountContext | null;
  },
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

    const history = await conversations.listApiHistory(input.conversationId);
    const tools = await accountTools(deps, input.account ?? null, input.conversationId, history);

    let result: AnswererResult | { kind: 'error' };
    try {
      result = await deps.answerer({
        history,
        userTurn,
        ...(tools ? { tools } : {}),
      });
    } catch (error) {
      logger.error({ err: error, conversationId: input.conversationId }, 'answerer failed');
      result = { kind: 'error' };
    }

    const finalized: Reply =
      result.kind === 'answer'
        ? finalizeReply({
            answer: result.answer,
            hits,
            loggedIn: Boolean(input.account),
            accountToolsUsed: result.toolsUsed.length,
          })
        : result.kind === 'refusal'
          ? fixedReply(input.pageLang, 'bot.noMatch', {
              action: 'ticket_form',
              outcome: 'refusal',
              flags: ['refusal'],
            })
          : fixedReply(input.pageLang, 'bot.error', {
              outcome: 'error',
              flags: ['error'] satisfies FlagReason[],
            });
    const reply = await unstick(conversations, input.conversationId, finalized);

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
        // Tool steps are only stored together with the final answer they led to.
        ...(result.kind === 'answer' ? { steps: result.steps } : {}),
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

/**
 * A second failed reply in a row within this conversation proactively offers the ticket form
 * with a fixed text, and flags the conversation for review.
 */
async function unstick(
  conversations: ConversationRepository,
  conversationId: string,
  reply: Reply,
): Promise<Reply> {
  if (!FAILED.has(reply.outcome)) return reply;
  const previous = await conversations.lastAssistantOutcome(conversationId);
  if (previous === null || !FAILED.has(previous)) return reply;
  return fixedReply(reply.lang, 'bot.stuck', {
    action: 'ticket_form',
    outcome: reply.outcome,
    flags: reply.flags.includes('needs_human') ? reply.flags : [...reply.flags, 'needs_human'],
  });
}

/** Names of tools called anywhere in the stored history. */
function toolsInHistory(history: ApiHistoryEntry[]): Set<string> {
  const names = new Set<string>();
  for (const entry of history) {
    if (!Array.isArray(entry.content)) continue;
    for (const block of entry.content as { type?: unknown; name?: unknown }[]) {
      if (block?.type === 'tool_use' && typeof block.name === 'string') names.add(block.name);
    }
  }
  return names;
}

/**
 * Tools for the bound account: by membership status, minus switched-off ones. Ids come from the
 * server. Tools already used in the stored history stay defined (the API rejects tool blocks
 * without definitions), but execute() still refuses anything not available right now.
 */
async function accountTools(
  deps: AnswerMessageDeps,
  account: AccountContext | null,
  conversationId: string,
  history: ApiHistoryEntry[],
): Promise<AnswererTools | undefined> {
  const used = toolsInHistory(history);
  if (!deps.capabilities || (!account && used.size === 0)) return undefined;
  const { capabilities, logger } = deps;
  let disabled: ReadonlySet<string>;
  try {
    disabled = await capabilities.disabled();
  } catch (error) {
    logger.error({ err: error, conversationId }, 'capability flags unavailable; tools off');
    disabled = new Set(CAPABILITIES.map((c) => c.name));
  }
  const available = account ? availableCapabilities(account.status, disabled) : [];
  const defined = CAPABILITIES.filter((c) => available.includes(c) || used.has(c.name));
  if (defined.length === 0) return undefined;
  return {
    definitions: toolDefinitions(defined),
    async execute(name) {
      const result = account
        ? await runCapability(name, account, capabilities.deps, disabled)
        : { ok: false as const };
      // Tool name and outcome only: never the account data.
      logger.info({ conversationId, tool: name, ok: result.ok }, 'account tool');
      return result;
    },
  };
}
