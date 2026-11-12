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
