import type { Answerer } from '@trainmore/core';

const MEMBERSHIP_WORDS = /abonnement|lidmaatschap|contract|membership/i;

/**
 * Deterministic stand-in for Claude, for local smoke tests without API spend
 * (APP_ENV=local and CHAT_FAKE_ANSWERER=1 only). Cites the first retrieved article, or — when the
 * customer is logged in and asks about their membership — calls get_memberships once.
 */
export function createFakeAnswerer(): Answerer {
  return async ({ userTurn, tools }) => {
    const language = /<page_language>nl<\/page_language>/.test(userTurn) ? 'nl' : 'en';
    const question = /<customer_message>([\s\S]*)<\/customer_message>/.exec(userTurn)?.[1] ?? '';

    if (
      tools?.definitions.some((d) => d.name === 'get_memberships') &&
      MEMBERSHIP_WORDS.test(question)
    ) {
      const result = await tools.execute('get_memberships');
      const plans = result.ok
        ? (result.data as { rateName?: string }[]).map((c) => c.rateName).join(', ')
        : '';
      const answer = {
        language,
        intent: 'account_question',
        answer: result.ok
          ? `[fake answer] Your membership: ${plans}.`
          : '[fake answer] Could not load your membership.',
        citedArticleIds: [] as number[],
        confidence: 'high',
        needsHuman: false,
      } as const;
      return {
        kind: 'answer',
        answer,
        assistantContent: [{ type: 'text', text: JSON.stringify(answer) }],
        steps: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'fake-1', name: 'get_memberships', input: {} }],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'fake-1', content: JSON.stringify(result) },
            ],
          },
        ],
        toolsUsed: result.ok ? ['get_memberships'] : [],
      };
    }

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
      steps: [],
      toolsUsed: [],
    };
  };
}
