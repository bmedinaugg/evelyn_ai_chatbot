import type { Citation, FaqSearchHit, FlagReason, Outcome } from '@trainmore/db';
import { type Lang, t } from '@trainmore/i18n';
import type { Answer } from './answer-schema.ts';

export type ReplyAction = 'none' | 'lead_form' | 'contact' | 'login';

export type Reply = {
  text: string;
  lang: Lang;
  citations: Citation[];
  action: ReplyAction;
  outcome: Outcome;
  flags: FlagReason[];
};

const MAX_TEXT = 1200;

/** Removes links the model may have written; links are only ever added from cited articles. */
export function sanitizeAnswerText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_TEXT);
}

/**
 * Turns the model's structured answer into what the customer sees. The model never decides which
 * articles exist, which links are shown, or the text for declines and hand-offs.
 */
export function finalizeReply(input: {
  answer: Answer;
  hits: FaqSearchHit[];
  /** Logged-in customer with a bound account (M2a); account tools come in M2b. */
  loggedIn?: boolean;
}): Reply {
  const { answer, hits } = input;
  const lang = answer.language;
  const fixed = (
    key:
      | 'bot.noMatch'
      | 'bot.offTopic'
      | 'bot.accountQuestion'
      | 'bot.wantsHuman'
      | 'bot.loginNeeded'
      | 'bot.greeting'
      | 'bot.salesLead',
    action: ReplyAction,
    outcome: Outcome,
    flags: FlagReason[],
  ): Reply => ({ text: t(lang, key), lang, citations: [], action, outcome, flags });

  const hitsById = new Map(hits.map((hit) => [hit.articleId, hit]));
  if (answer.citedArticleIds.some((id) => !hitsById.has(id))) {
    return fixed('bot.noMatch', 'contact', 'invalid_citation', ['invalid_citation']);
  }
  const citations: Citation[] = [...new Set(answer.citedArticleIds)].flatMap((id) => {
    const hit = hitsById.get(id);
    return hit ? [{ articleId: hit.articleId, title: hit.title, url: hit.url }] : [];
  });
  const text = sanitizeAnswerText(answer.answer);

  switch (answer.intent) {
    case 'off_topic':
      return fixed('bot.offTopic', 'none', 'declined', []);
    case 'account_question':
      return input.loggedIn
        ? fixed('bot.accountQuestion', 'contact', 'unsupported', ['account_question'])
        : fixed('bot.loginNeeded', 'login', 'unsupported', ['account_question']);
    case 'wants_human':
      return fixed('bot.wantsHuman', 'contact', 'handoff', ['wants_human']);
    case 'greeting':
      // Fixed text: model-written small talk could still invent offers or prices.
      return fixed('bot.greeting', 'none', 'answered', []);
    case 'sales_lead':
      // Model text only when grounded in a cited article; otherwise a fixed text (no invented prices).
      return citations.length > 0 && answer.confidence !== 'low' && text
        ? { text, lang, citations, action: 'lead_form', outcome: 'answered', flags: [] }
        : fixed('bot.salesLead', 'lead_form', 'answered', []);
    case 'faq': {
      const flags: FlagReason[] = [];
      if (citations.length === 0) flags.push('no_match');
      if (answer.confidence === 'low') flags.push('low_confidence');
      if (answer.needsHuman) flags.push('needs_human');
      if (flags.length > 0 || !text) {
        return fixed('bot.noMatch', 'contact', 'no_match', flags.length > 0 ? flags : ['no_match']);
      }
      return { text, lang, citations, action: 'none', outcome: 'answered', flags: [] };
    }
  }
}
