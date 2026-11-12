import type { Answerer } from '@trainmore/core';

/**
 * Deterministic stand-in for Claude, for local smoke tests without API spend
 * (APP_ENV=local and CHAT_FAKE_ANSWERER=1 only). Cites the first retrieved article.
 */
export function createFakeAnswerer(): Answerer {
  return async ({ userTurn }) => {
    const language = /<page_language>nl<\/page_language>/.test(userTurn) ? 'nl' : 'en';
    const firstId = /<article id="(\d+)"/.exec(userTurn)?.[1];
    const answer = {
      language,
      intent: 'faq',
      answer: firstId ? `[fake answer] See article ${firstId}.` : '[fake answer] No article found.',
      citedArticleIds: firstId ? [Number(firstId)] : [],
      confidence: firstId ? 'high' : 'low',
      needsHuman: false,
    } as const;
    return {
      kind: 'answer',
      answer: { ...answer, citedArticleIds: [...answer.citedArticleIds] },
      assistantContent: [{ type: 'text', text: JSON.stringify(answer) }],
    };
  };
}
