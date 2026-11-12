import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ApiHistoryEntry } from '@trainmore/db';
import { type Answer, answerSchema } from './answer-schema.ts';
import { escapeForPrompt, SYSTEM_PROMPT } from './prompt.ts';

export type CreateClient = Pick<Anthropic['beta']['messages'], 'create'>;

export type AnswererResult =
  | {
      kind: 'answer';
      answer: Answer;
      assistantContent: unknown;
      /** Tool calls and results of this turn, to store between the question and the answer. */
      steps: ApiHistoryEntry[];
      /** Tools that ran successfully this turn. */
      toolsUsed: string[];
    }
  | { kind: 'refusal' }
  | { kind: 'invalid' };

/** Account tools for a logged-in customer; execute() runs a tool for the bound account only. */
export type AnswererTools = {
  definitions: Anthropic.Beta.BetaTool[];
  execute(name: string): Promise<{ ok: true; data: unknown } | { ok: false }>;
};

export type Answerer = (input: {
  history: ApiHistoryEntry[];
  userTurn: string;
  tools?: AnswererTools;
}) => Promise<AnswererResult>;

export const MAX_TOOL_ROUNDS = 4;

// Plain JSON schema for output_config.format. We parse ourselves (not messages.parse) so that a
// refusal is recognised before any parsing, and malformed output never throws with model text.
const { parse: _sdkParse, ...ANSWER_FORMAT } = betaZodOutputFormat(answerSchema);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Tool output is untrusted data: wrapped and escaped so it cannot open or close prompt tags. */
function toolResult(id: string, name: string, result: { ok: true; data: unknown } | { ok: false }) {
  return result.ok
    ? {
        type: 'tool_result' as const,
        tool_use_id: id,
        content: `<account_data tool="${name}">${escapeForPrompt(JSON.stringify(result.data))}</account_data>`,
      }
    : {
        type: 'tool_result' as const,
        tool_use_id: id,
        content: '{"error":"unavailable"}',
        is_error: true,
      };
}

/**
 * One customer message: Claude may call read-only account tools (manual loop, at most
 * MAX_TOOL_ROUNDS), then gives a structured answer. Adaptive thinking at low effort (chat),
 * server-side refusal fallback, prompt caching. SDK errors propagate.
 */
export function createClaudeAnswerer(opts: { client: CreateClient; model: string }): Answerer {
  return async ({ history, userTurn, tools }) => {
    // Stored history is replayed exactly as it was received (append-only, preserved thinking).
    const base: Anthropic.Beta.BetaMessageParam[] = [
      ...(history as Anthropic.Beta.BetaMessageParam[]),
      { role: 'user', content: userTurn },
    ];
    const steps: ApiHistoryEntry[] = [];
    const toolsUsed: string[] = [];

    for (let round = 0; ; round += 1) {
      const response = await opts.client.create({
        model: opts.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Top-level breakpoint caches the newest turn, so earlier history is a cache read next time.
        cache_control: { type: 'ephemeral' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'low', format: ANSWER_FORMAT },
        ...(tools && tools.definitions.length > 0 ? { tools: tools.definitions } : {}),
        messages: [...base, ...(steps as Anthropic.Beta.BetaMessageParam[])],
      });

      if (response.stop_reason === 'refusal') return { kind: 'refusal' };

      if (response.stop_reason === 'tool_use' && tools) {
        if (round >= MAX_TOOL_ROUNDS) return { kind: 'invalid' };
        const calls = response.content.filter(
          (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
        );
        const results = [];
        for (const call of calls) {
          const result = await tools.execute(call.name);
          if (result.ok) toolsUsed.push(call.name);
          results.push(toolResult(call.id, call.name, result));
        }
        // All results of one round go back together in a single user message.
        steps.push(
          { role: 'assistant', content: clone(response.content) },
          { role: 'user', content: results },
        );
        continue;
      }

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
        assistantContent: clone(response.content),
        steps,
        toolsUsed,
      };
    }
  };
}
