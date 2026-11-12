import { Writable } from 'node:stream';
import { createLogger } from '@trainmore/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { answerMessage, ConversationBusyError } from '../src/answer-message.ts';
import type { Answer } from '../src/answer-schema.ts';
import type { Answerer, AnswererResult } from '../src/claude-answerer.ts';
import { fakeConversations, fakeFaq } from './fakes.ts';
import { cancelNl } from './hits.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const answer: Answer = {
  language: 'nl',
  intent: 'faq',
  answer: 'Je kunt opzeggen via de app.',
  citedArticleIds: [900101],
  confidence: 'high',
  needsHuman: false,
};

let logOutput: string;
const logger = createLogger({
  name: 'test',
  level: 'info',
  destination: new Writable({
    write(chunk, _encoding, callback) {
      logOutput += chunk.toString();
      callback();
    },
  }),
});

function recordingAnswerer(result: AnswererResult | Error) {
  const calls: Parameters<Answerer>[0][] = [];
  const answerer: Answerer = async (input) => {
    calls.push(input);
    if (result instanceof Error) throw result;
    return result;
  };
  return { answerer, calls };
}

const answered: AnswererResult = {
  kind: 'answer',
  answer,
  assistantContent: [{ type: 'text', text: JSON.stringify(answer) }],
  steps: [],
  toolsUsed: [],
};

beforeEach(() => {
  logOutput = '';
});

describe('answerMessage', () => {
  it('answers and stores the user and assistant turn', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'nl', userMessageCount: 0 });
    const { answerer } = recordingAnswerer(answered);
    const reply = await answerMessage(
      { faq: fakeFaq([cancelNl]), conversations: conv.repo, answerer, logger },
      { conversationId: ID, text: 'Hoe zeg ik op?', pageLang: 'nl' },
    );
    expect(reply.outcome).toBe('answered');
    expect(reply.citations.map((c) => c.articleId)).toEqual([900101]);
    expect(conv.turns).toHaveLength(1);
    expect(conv.turns[0]?.user.displayText).toBe('Hoe zeg ik op?');
    expect(conv.turns[0]?.user.apiContent).toContain(
      '<customer_message>Hoe zeg ik op?</customer_message>',
    );
    expect(conv.turns[0]?.assistant).toMatchObject({
      displayText: 'Je kunt opzeggen via de app.',
      outcome: 'answered',
      apiContent: answered.kind === 'answer' ? answered.assistantContent : undefined,
    });
    expect(conv.isClaimed()).toBe(false);
  });

  it('refuses a second turn while one is in flight', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'nl', userMessageCount: 0 });
    conv.claim();
    const { answerer, calls } = recordingAnswerer(answered);
    await expect(
      answerMessage(
        { faq: fakeFaq([]), conversations: conv.repo, answerer, logger },
        { conversationId: ID, text: 'x', pageLang: 'nl' },
      ),
    ).rejects.toBeInstanceOf(ConversationBusyError);
    expect(calls).toHaveLength(0);
    expect(conv.turns).toHaveLength(0);
  });

  it('stops at 20 customer messages without calling Claude', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'en', userMessageCount: 20 });
    const { answerer, calls } = recordingAnswerer(answered);
    const reply = await answerMessage(
      { faq: fakeFaq([]), conversations: conv.repo, answerer, logger },
      { conversationId: ID, text: 'x', pageLang: 'en' },
    );
    expect(reply).toMatchObject({
      outcome: 'limit',
      text: 'This conversation has reached its limit. Please start a new chat.',
    });
    expect(calls).toHaveLength(0);
    expect(conv.isClaimed()).toBe(false);
  });

  it('stores only the user message on a refusal', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'en', userMessageCount: 0 });
    const { answerer } = recordingAnswerer({ kind: 'refusal' });
    const reply = await answerMessage(
      { faq: fakeFaq([]), conversations: conv.repo, answerer, logger },
      { conversationId: ID, text: 'x', pageLang: 'en' },
    );
    expect(reply).toMatchObject({ outcome: 'refusal', action: 'contact', flags: ['refusal'] });
    expect(conv.turns[0]?.assistant).toBeNull();
    expect(conv.turns[0]?.flags).toEqual(['refusal']);
  });

  it('turns an answerer error into a generic reply and releases the claim', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'en', userMessageCount: 0 });
    const { answerer } = recordingAnswerer(new Error('upstream down'));
    const reply = await answerMessage(
      { faq: fakeFaq([]), conversations: conv.repo, answerer, logger },
      { conversationId: ID, text: 'x', pageLang: 'en' },
    );
    expect(reply).toMatchObject({ outcome: 'error', action: 'none', flags: ['error'] });
    expect(conv.turns[0]?.assistant).toBeNull();
    expect(conv.isClaimed()).toBe(false);
  });

  it('replays the stored history unchanged (append-only)', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'nl', userMessageCount: 0 });
    const { answerer, calls } = recordingAnswerer(answered);
    const deps = { faq: fakeFaq([cancelNl]), conversations: conv.repo, answerer, logger };
    await answerMessage(deps, { conversationId: ID, text: 'eerste', pageLang: 'nl' });
    await answerMessage(deps, { conversationId: ID, text: 'tweede', pageLang: 'nl' });
    expect(calls[1]?.history).toEqual(
      await conv.repo.listApiHistory(ID).then((h) => h.slice(0, 2)),
    );
    expect(calls[1]?.history[0]?.content).toBe(conv.turns[0]?.user.apiContent);
  });

  it('drops the result when the claim was lost (a newer turn took over)', async () => {
    const conv = fakeConversations(
      { id: ID, tokenHash: 'h', lang: 'nl', userMessageCount: 0 },
      { loseClaim: true },
    );
    const { answerer } = recordingAnswerer(answered);
    await expect(
      answerMessage(
        { faq: fakeFaq([cancelNl]), conversations: conv.repo, answerer, logger },
        { conversationId: ID, text: 'x', pageLang: 'nl' },
      ),
    ).rejects.toBeInstanceOf(ConversationBusyError);
    expect(conv.turns).toHaveLength(0);
    expect(conv.releases).toEqual(['claim-1']);
  });

  it('never logs the customer text', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'nl', userMessageCount: 0 });
    const { answerer } = recordingAnswerer(answered);
    await answerMessage(
      { faq: fakeFaq([cancelNl]), conversations: conv.repo, answerer, logger },
      { conversationId: ID, text: 'Mijn geheime vraag 4821', pageLang: 'nl' },
    );
    expect(logOutput).toContain('outcome');
    expect(logOutput).not.toContain('geheime vraag');
  });
});

describe('answerMessage with a bound account', () => {
  const account = { customerId: 4, studioId: 1001, status: 'MEMBER' as const };

  it('offers account tools, runs them for the bound account and stores the steps', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'nl', userMessageCount: 0 });
    const ran: { name: string; customerId: number }[] = [];
    const answerer: Answerer = async ({ tools }) => {
      expect(tools?.definitions.map((d) => d.name)).toContain('get_memberships');
      const result = await tools?.execute('get_memberships');
      expect(result).toEqual({ ok: true, data: [{ rateName: 'Flex' }] });
      return {
        kind: 'answer',
        answer: {
          ...answer,
          intent: 'account_question',
          answer: 'Je hebt Flex.',
          citedArticleIds: [],
        },
        assistantContent: [{ type: 'text', text: '{}' }],
        steps: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 't1', name: 'get_memberships', input: {} }],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
        ],
        toolsUsed: ['get_memberships'],
      };
    };
    const reply = await answerMessage(
      {
        faq: fakeFaq([]),
        conversations: conv.repo,
        answerer,
        logger,
        capabilities: {
          deps: {
            studioClient: async () =>
              ({
                getContracts: async (customerId: number) => {
                  ran.push({ name: 'get_memberships', customerId });
                  return [{ rateName: 'Flex' }];
                },
              }) as never,
            crossStudioClient: async () => ({}) as never,
            today: () => new Date('2026-11-12'),
          },
          disabled: async () => new Set(),
        },
      },
      { conversationId: ID, text: 'Welk abonnement heb ik?', pageLang: 'nl', account },
    );
    expect(reply).toMatchObject({ outcome: 'answered', text: 'Je hebt Flex.' });
    expect(ran).toEqual([{ name: 'get_memberships', customerId: 4 }]);
    expect(conv.turns[0]?.steps).toHaveLength(2);
  });

  it('offers no tools without a bound account', async () => {
    const conv = fakeConversations({ id: ID, tokenHash: 'h', lang: 'nl', userMessageCount: 0 });
    const { answerer, calls } = recordingAnswerer(answered);
    await answerMessage(
      { faq: fakeFaq([]), conversations: conv.repo, answerer, logger },
      { conversationId: ID, text: 'x', pageLang: 'nl' },
    );
    expect(calls[0]?.tools).toBeUndefined();
  });
});
