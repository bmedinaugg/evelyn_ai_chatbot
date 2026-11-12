import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ApiHistoryEntry } from '@trainmore/db';
import { type Answer, answerSchema } from './answer-schema.ts';
import { SYSTEM_PROMPT } from './prompt.ts';

export type ParseClient = Pick<Anthropic['beta']['messages'], 'parse'>;

export type AnswererResult =
  | { kind: 'answer'; answer: Answer; assistantContent: unknown }
  | { kind: 'refusal' }
  | { kind: 'invalid' };

export type Answerer = (input: {
  history: ApiHistoryEntry[];
  userTurn: string;
}) => Promise<AnswererResult>;

/**
 * One Claude call per customer message: structured output (validated by the SDK against
 * answerSchema), adaptive thinking at low effort (chat), and server-side refusal fallback.
 * SDK errors propagate; the caller turns them into a generic reply.
 */
export function createClaudeAnswerer(opts: { client: ParseClient; model: string }): Answerer {
  return async ({ history, userTurn }) => {
    const response = await opts.client.parse({
      model: opts.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: betaZodOutputFormat(answerSchema) },
      // Stored history is replayed exactly as it was received (append-only, preserved thinking).
      messages: [
        ...(history as Anthropic.Beta.BetaMessageParam[]),
        { role: 'user', content: userTurn },
      ],
    });

    if (response.stop_reason === 'refusal') return { kind: 'refusal' };
    if (response.parsed_output === null) return { kind: 'invalid' };
    return {
      kind: 'answer',
      answer: response.parsed_output,
      // JSON round trip drops the SDK's non-enumerable parsed_output; blocks stay unchanged.
      assistantContent: JSON.parse(JSON.stringify(response.content)),
    };
  };
}
