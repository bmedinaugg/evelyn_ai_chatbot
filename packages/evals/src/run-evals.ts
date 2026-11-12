import type Anthropic from '@anthropic-ai/sdk';
import {
  type AnswerMessageDeps,
  answerMessage,
  type CreateClient,
  createClaudeAnswerer,
  type LoginDeps,
  type Reply,
  requestLoginCode,
  selectAccount,
  verifyLoginCode,
} from '@trainmore/core';
import type { ConversationRepository, FaqRepository } from '@trainmore/db';
import type { Logger } from '@trainmore/shared';
import { checkReply } from './assertions.ts';
import type { EvalCase } from './cases.ts';

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type EvalResult = { id: string; failures: string[]; reply: Reply; usage: Usage };

// Claude Sonnet 5.5, USD per million tokens (claude-api skill, 2026-10-06); cache writes at 1.25x input.
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

export function estimateUsd(usage: Usage): number {
  return (
    (usage.input * PRICE.input +
      usage.output * PRICE.output +
      usage.cacheRead * PRICE.cacheRead +
      usage.cacheWrite * PRICE.cacheWrite) /
    1_000_000
  );
}

/** Wraps the SDK client to record token usage per call. */
function recordUsage(inner: CreateClient, onUsage: (usage: Usage) => void): CreateClient {
  return {
    // Cast: create is overloaded (streaming/non-streaming); the answerer never streams.
    create: (async (...args: Parameters<CreateClient['create']>) => {
      const response = (await inner.create(...args)) as Anthropic.Beta.BetaMessage;
      onUsage({
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      });
      return response;
    }) as unknown as CreateClient['create'],
  };
}

export type EvalDeps = {
  faq: FaqRepository;
  conversations: ConversationRepository;
  client: CreateClient;
  model: string;
  logger: Logger;
  /** For cases with loginAs: login against the mock Magicline (codes captured, never emailed). */
  login?: Omit<LoginDeps, 'email'>;
  capabilities?: AnswerMessageDeps['capabilities'];
};

async function logIn(
  login: Omit<LoginDeps, 'email'>,
  conversationId: string,
  email: string,
): Promise<void> {
  let code = '';
  const deps: LoginDeps = {
    ...login,
    email: {
      sendLoginCode: async (message) => {
        code = message.code;
      },
    },
  };
  await requestLoginCode(deps, { conversationId, email, lang: 'nl' });
  const outcome = await verifyLoginCode(deps, { conversationId, email, code });
  if (outcome.kind !== 'verified') throw new Error(`eval login failed: ${outcome.kind}`);
  if (outcome.selected === null && outcome.accounts.length > 0) {
    await selectAccount(deps, { conversationId, index: 0 });
  }
}

export async function runEvals(deps: EvalDeps, cases: EvalCase[]): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const evalCase of cases) {
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const client = recordUsage(deps.client, (u) => {
      usage.input += u.input;
      usage.output += u.output;
      usage.cacheRead += u.cacheRead;
      usage.cacheWrite += u.cacheWrite;
    });
    const answerer = createClaudeAnswerer({ client, model: deps.model });
    const { id } = await deps.conversations.create({
      tokenHash: 'eval-run',
      lang: evalCase.pageLang,
    });
    let account = null;
    if (evalCase.loginAs) {
      if (!deps.login) throw new Error(`eval case ${evalCase.id} needs login deps`);
      await logIn(deps.login, id, evalCase.loginAs);
      account = (await deps.login.auth.getAuthState(id)).account;
    }
    let reply: Reply | undefined;
    for (const text of evalCase.turns) {
      reply = await answerMessage(
        {
          faq: deps.faq,
          conversations: deps.conversations,
          answerer,
          logger: deps.logger,
          ...(deps.capabilities ? { capabilities: deps.capabilities } : {}),
        },
        { conversationId: id, text, pageLang: evalCase.pageLang, account },
      );
    }
    if (!reply) throw new Error(`eval case ${evalCase.id} has no turns`);
    results.push({ id: evalCase.id, failures: checkReply(reply, evalCase.expect), reply, usage });
  }
  return results;
}
