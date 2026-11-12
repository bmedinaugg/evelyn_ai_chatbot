import { answerMessage, createClaudeAnswerer, type ParseClient, type Reply } from '@trainmore/core';
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
function recordUsage(inner: ParseClient, onUsage: (usage: Usage) => void): ParseClient {
  return {
    // Cast: parse is generic over its params; this wrapper only observes the result.
    parse: (async (...args: Parameters<ParseClient['parse']>) => {
      const response = await inner.parse(...args);
      onUsage({
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      });
      return response;
    }) as unknown as ParseClient['parse'],
  };
}

export async function runEvals(
  deps: {
    faq: FaqRepository;
    conversations: ConversationRepository;
    client: ParseClient;
    model: string;
    logger: Logger;
  },
  cases: EvalCase[],
): Promise<EvalResult[]> {
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
    let reply: Reply | undefined;
    for (const text of evalCase.turns) {
      reply = await answerMessage(
        { faq: deps.faq, conversations: deps.conversations, answerer, logger: deps.logger },
        { conversationId: id, text, pageLang: evalCase.pageLang },
      );
    }
    if (!reply) throw new Error(`eval case ${evalCase.id} has no turns`);
    results.push({ id: evalCase.id, failures: checkReply(reply, evalCase.expect), reply, usage });
  }
  return results;
}
