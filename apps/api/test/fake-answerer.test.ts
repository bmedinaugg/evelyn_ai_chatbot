import { buildUserTurn } from '@trainmore/core';
import { describe, expect, it } from 'vitest';
import { createFakeAnswerer } from '../src/fake-answerer.ts';

describe('createFakeAnswerer (local smoke tests only)', () => {
  it('cites the first retrieved article in the page language', async () => {
    const userTurn = buildUserTurn({
      customerMessage: 'opzeggen',
      articles: [
        {
          articleId: 900101,
          lang: 'nl',
          title: 'Opzeggen',
          body: 'Via de app.',
          url: 'https://x/1',
          rank: 1,
        },
      ],
      pageLang: 'nl',
    });
    const result = await createFakeAnswerer()({ history: [], userTurn });
    expect(result).toMatchObject({
      kind: 'answer',
      answer: { language: 'nl', intent: 'faq', citedArticleIds: [900101], confidence: 'high' },
    });
  });

  it('hands off when nothing was retrieved', async () => {
    const userTurn = buildUserTurn({ customerMessage: 'x', articles: [], pageLang: 'en' });
    const result = await createFakeAnswerer()({ history: [], userTurn });
    expect(result).toMatchObject({
      kind: 'answer',
      answer: { citedArticleIds: [], confidence: 'low' },
    });
  });
});

describe('createFakeAnswerer with account tools', () => {
  it('calls get_memberships for a membership question and answers from its data', async () => {
    const userTurn = buildUserTurn({
      customerMessage: 'Welk abonnement heb ik?',
      articles: [],
      pageLang: 'nl',
    });
    const executed: string[] = [];
    const result = await createFakeAnswerer()({
      history: [],
      userTurn,
      tools: {
        definitions: [
          {
            name: 'get_memberships',
            input_schema: { type: 'object', properties: {}, additionalProperties: false },
          },
        ],
        execute: async (name) => {
          executed.push(name);
          return { ok: true, data: [{ rateName: 'Flex', endDate: '2027-01-31' }] };
        },
      },
    });
    expect(executed).toEqual(['get_memberships']);
    expect(result).toMatchObject({
      kind: 'answer',
      toolsUsed: ['get_memberships'],
      answer: { intent: 'account_question' },
    });
    expect(result.kind === 'answer' && result.answer.answer).toContain('Flex');
  });
});
