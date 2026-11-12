import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ApiHistoryEntry } from '@trainmore/db';
import { type Answer, answerSchema } from './answer-schema.ts';
import { SYSTEM_PROMPT } from './prompt.ts';

export type CreateClient = Pick<Anthropic['beta']['messages'], 'create'>;

export type AnswererResult =
  | { kind: 'answer'; answer: Answer; assistantContent: unknown }
  | { kind: 'refusal' }
  | { kind: 'invalid' };

export type Answerer = (input: {
  history: ApiHistoryEntry[];
  userTurn: string;
}) => Promise<AnswererResult>;

// Plain JSON schema for output_config.format. We parse ourselves (not messages.parse) so that a
// refusal is recognised before any parsing, and malformed output never throws with model text.
const { parse: _sdkParse, ...ANSWER_FORMAT } = betaZodOutputFormat(answerSchema);

/**
 * One Claude call per customer message: structured output, adaptive thinking at low effort (chat),
 * server-side refusal fallback, and caching of the system prompt and the conversation so far.
 * SDK errors propagate; the caller turns them into a generic reply.
 */
export function createClaudeAnswerer(opts: { client: CreateClient; model: string }): Answerer {
  return async ({ history, userTurn }) => {
    const response = await opts.client.create({
      model: opts.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Top-level breakpoint caches the newest turn, so earlier history is a cache read next time.
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: ANSWER_FORMAT },
      // Stored history is replayed exactly as it was received (append-only, preserved thinking).
      messages: [
        ...(history as Anthropic.Beta.BetaMessageParam[]),
        { role: 'user', content: userTurn },
      ],
    });

    if (response.stop_reason === 'refusal') return { kind: 'refusal' };
    if (response.stop_reason !== 'end_turn') return { kind: 'invalid' };
    const text = response.content.find((block) => block.type === 'text')?.text;
    if (text === undefined) return { kind: 'invalid' };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { kind: 'invalid' };
    }
    const parsed = answerSchema.safeParse(json);
    if (!parsed.success) return { kind: 'invalid' };
    return {
      kind: 'answer',
      answer: parsed.data,
      assistantContent: JSON.parse(JSON.stringify(response.content)),
    };
  };
}
