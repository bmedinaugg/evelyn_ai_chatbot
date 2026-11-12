import type { ApiHistoryEntry, CustomerStatus, FaqRepository, ScenarioHit } from '@trainmore/db';
import type { Lang } from '@trainmore/i18n';
import type { Logger } from '@trainmore/shared';
import type { AnswerMessageDeps } from './answer-message.ts';
import {
  type AccountContext,
  availableCapabilities,
  CAPABILITIES,
  runCapability,
  toolDefinitions,
} from './capabilities/catalogue.ts';
import type { Answerer, AnswererTools } from './claude-answerer.ts';
import { finalizeReply, type Reply } from './finalize-reply.ts';
import { buildUserTurn } from './prompt.ts';

export const MAX_REPLAY_QUESTIONS = 10;
const SEARCH_LIMIT = 5;
const SCENARIO_LIMIT = 3;

/** Synthetic mock-Magicline customers per status (apps/mock-magicline/fixtures/profiles.ts). */
export const REPLAY_PROFILES: Readonly<Record<CustomerStatus, AccountContext>> = {
  MEMBER: { customerId: 1, studioId: 1001, status: 'MEMBER' },
  PROSPECT: { customerId: 2, studioId: 1001, status: 'PROSPECT' },
  FORMER_MEMBER: { customerId: 3, studioId: 1002, status: 'FORMER_MEMBER' },
};

export type ReplayDeps = {
  faq: Pick<FaqRepository, 'search'>;
  scenarios: NonNullable<AnswerMessageDeps['scenarios']>;
  answerer: Answerer;
  /** Must point at the mock Magicline: the caller only allows replay where MAGICLINE_USE_MOCK. */
  capabilities: NonNullable<AnswerMessageDeps['capabilities']>;
  logger: Logger;
};

/**
 * Re-asks a conversation's customer questions with a draft approved answer offered in place of
 * that scenario's live version, to compare answers before publishing. Nothing is stored: the
 * history lives in memory, and account questions use the synthetic profile for `status`.
 */
export async function replayConversation(
  deps: ReplayDeps,
  input: { questions: string[]; pageLang: Lang; status: CustomerStatus | null; draft: ScenarioHit },
): Promise<{ question: string; reply: Reply }[]> {
  const account = input.status ? REPLAY_PROFILES[input.status] : null;
  const tools = account ? await replayTools(deps, account) : undefined;
  const history: ApiHistoryEntry[] = [];
  const results: { question: string; reply: Reply }[] = [];

  for (const question of input.questions.slice(0, MAX_REPLAY_QUESTIONS)) {
    const hits = await deps.faq.search(question, input.pageLang, SEARCH_LIMIT);
    const live = await deps.scenarios.search(question, input.pageLang, SCENARIO_LIMIT);
    const scenarios = [
      input.draft,
      ...live.filter((s) => s.scenarioId !== input.draft.scenarioId),
    ].slice(0, SCENARIO_LIMIT);
    const userTurn = buildUserTurn({
      customerMessage: question,
      articles: hits,
      pageLang: input.pageLang,
      scenarios,
    });
    // A snapshot: the history grows after this call.
    const result = await deps.answerer({
      history: [...history],
      userTurn,
      ...(tools ? { tools } : {}),
    });
    history.push({ role: 'user', content: userTurn });
    if (result.kind !== 'answer') {
      results.push({
        question,
        reply: {
          text: '',
          lang: input.pageLang,
          citations: [],
          action: 'none',
          outcome: result.kind === 'refusal' ? 'refusal' : 'error',
          flags: [],
        },
      });
      // Keep the history replayable: a user turn needs an answer before the next one.
      history.pop();
      continue;
    }
    history.push(...result.steps, { role: 'assistant', content: result.assistantContent });
    results.push({
      question,
      reply: finalizeReply({
        answer: result.answer,
        hits,
        loggedIn: account !== null,
        accountToolsUsed: result.toolsUsed.length,
        scenarios,
        accountStatus: account?.status ?? null,
      }),
    });
  }
  deps.logger.info({ questions: results.length, status: input.status }, 'replay finished');
  return results;
}

async function replayTools(
  deps: ReplayDeps,
  account: AccountContext,
): Promise<AnswererTools | undefined> {
  let disabled: ReadonlySet<string>;
  try {
    disabled = await deps.capabilities.disabled();
  } catch {
    disabled = new Set(CAPABILITIES.map((c) => c.name));
  }
  const available = availableCapabilities(account.status, disabled);
  if (available.length === 0) return undefined;
  return {
    definitions: toolDefinitions(available),
    execute: (name) => runCapability(name, account, deps.capabilities.deps, disabled),
  };
}
