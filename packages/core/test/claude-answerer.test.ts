import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { Answer } from '../src/answer-schema.ts';
import { createClaudeAnswerer, type ParseClient } from '../src/claude-answerer.ts';

const answer: Answer = {
  language: 'nl',
  intent: 'faq',
  answer: 'Via de app.',
  citedArticleIds: [900101],
  confidence: 'high',
  needsHuman: false,
};

function fakeParse(response: Record<string, unknown> | Error): {
  client: ParseClient;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  const client = {
    // The SDK's parse is generic; the fake only needs to record params and return a canned message.
    parse: (async (params: Record<string, unknown>) => {
      calls.push(params);
      if (response instanceof Error) throw response;
      return response;
    }) as unknown as ParseClient['parse'],
  };
  return { client, calls };
}

function parsedMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const textBlock = { type: 'text', text: JSON.stringify(answer), citations: null };
  Object.defineProperty(textBlock, 'parsed_output', { value: answer, enumerable: false });
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '', signature: 'sig-1' }, textBlock],
    parsed_output: answer,
    ...overrides,
  };
}

const history = [
  { role: 'user' as const, content: 'earlier question' },
  { role: 'assistant' as const, content: [{ type: 'text', text: '{}' }] },
];

describe('createClaudeAnswerer', () => {
  it('sends the exact request shape', async () => {
    const { client, calls } = fakeParse(parsedMessage());
    await createClaudeAnswerer({ client, model: 'claude-sonnet-5-5' })({
      history,
      userTurn: 'new turn',
    });
    const params = calls[0] ?? {};
    expect(params).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
      messages: [...history, { role: 'user', content: 'new turn' }],
    });
    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('tool_choice');
    expect((params.output_config as { format?: unknown }).format).toBeDefined();
  });

  it('returns the answer and content without SDK-only fields', async () => {
    const { client } = fakeParse(parsedMessage());
    const result = await createClaudeAnswerer({ client, model: 'm' })({
      history: [],
      userTurn: 'q',
    });
    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') return;
    expect(result.answer).toEqual(answer);
    expect(JSON.stringify(result.assistantContent)).not.toContain('parsed_output');
    expect(result.assistantContent).toEqual([
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'text', text: JSON.stringify(answer), citations: null },
    ]);
  });

  it('maps a refusal', async () => {
    const { client } = fakeParse(parsedMessage({ stop_reason: 'refusal', parsed_output: null }));
    expect(
      await createClaudeAnswerer({ client, model: 'm' })({ history: [], userTurn: 'q' }),
    ).toEqual({
      kind: 'refusal',
    });
  });

  it('maps unparseable output to invalid', async () => {
    const { client } = fakeParse(parsedMessage({ parsed_output: null }));
    expect(
      await createClaudeAnswerer({ client, model: 'm' })({ history: [], userTurn: 'q' }),
    ).toEqual({
      kind: 'invalid',
    });
  });

  it('lets SDK errors propagate', async () => {
    const error = new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers());
    const { client } = fakeParse(error);
    await expect(
      createClaudeAnswerer({ client, model: 'm' })({ history: [], userTurn: 'q' }),
    ).rejects.toBeInstanceOf(Anthropic.RateLimitError);
  });
});
