import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { Answer } from '../src/answer-schema.ts';
import { type CreateClient, createClaudeAnswerer } from '../src/claude-answerer.ts';

const answer: Answer = {
  language: 'nl',
  intent: 'faq',
  answer: 'Via de app.',
  citedArticleIds: [900101],
  confidence: 'high',
  needsHuman: false,
};

function fakeCreate(response: Record<string, unknown> | Error): {
  client: CreateClient;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  const client = {
    // The SDK's create is overloaded (streaming/non-streaming); the fake records params and returns a message.
    create: (async (params: Record<string, unknown>) => {
      calls.push(params);
      if (response instanceof Error) throw response;
      return response;
    }) as unknown as CreateClient['create'],
  };
  return { client, calls };
}

function message(text: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'text', text, citations: null },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

const history = [
  { role: 'user' as const, content: 'earlier question' },
  { role: 'assistant' as const, content: [{ type: 'text', text: '{}' }] },
];
const run = (client: CreateClient) =>
  createClaudeAnswerer({ client, model: 'm' })({ history: [], userTurn: 'q' });

describe('createClaudeAnswerer', () => {
  it('sends the exact request shape, with caching on the newest turn', async () => {
    const { client, calls } = fakeCreate(message(JSON.stringify(answer)));
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
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
      messages: [...history, { role: 'user', content: 'new turn' }],
    });
    for (const key of ['thinking', 'temperature', 'tool_choice', 'stream'])
      expect(params).not.toHaveProperty(key);
    // Plain JSON schema: nothing that can't be serialised (no parse function).
    const format = (params.output_config as { format: unknown }).format;
    expect(JSON.parse(JSON.stringify(format))).toEqual(format);
  });

  it('returns the validated answer and the content unchanged', async () => {
    const result = await run(fakeCreate(message(JSON.stringify(answer))).client);
    expect(result).toEqual({
      kind: 'answer',
      answer,
      assistantContent: [
        { type: 'thinking', thinking: '', signature: 'sig-1' },
        { type: 'text', text: JSON.stringify(answer), citations: null },
      ],
    });
  });

  it('maps a refusal even when it carries partial text', async () => {
    const { client } = fakeCreate(message('{"language": "en", "ans', { stop_reason: 'refusal' }));
    expect(await run(client)).toEqual({ kind: 'refusal' });
  });

  it('maps non-JSON, truncated or schema-violating output to invalid', async () => {
    for (const text of [
      'Sorry, I cannot',
      '{"language": "nl"',
      JSON.stringify({ ...answer, intent: 'chitchat' }),
    ]) {
      expect(await run(fakeCreate(message(text)).client)).toEqual({ kind: 'invalid' });
    }
    expect(await run(fakeCreate(message('x', { stop_reason: 'max_tokens' })).client)).toEqual({
      kind: 'invalid',
    });
  });

  it('lets SDK errors propagate', async () => {
    const error = new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers());
    await expect(run(fakeCreate(error).client)).rejects.toBeInstanceOf(Anthropic.RateLimitError);
  });
});
