import type {
  Citation,
  CustomerStatus,
  FaqSearchHit,
  FlagReason,
  Outcome,
  ScenarioHit,
} from '@trainmore/db';
import { type Lang, t } from '@trainmore/i18n';
import type { Answer } from './answer-schema.ts';

/** ticket_form: the widget offers the general ticket form (hand-off to support). */
export type ReplyAction = 'none' | 'lead_form' | 'ticket_form' | 'login';

export type Reply = {
  text: string;
  lang: Lang;
  citations: Citation[];
  action: ReplyAction;
  outcome: Outcome;
  flags: FlagReason[];
  /** Set when the reply is an approved answer shown word for word. */
  scenarioVersionId?: number;
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
  /** Logged-in customer with a bound account. */
  loggedIn?: boolean;
  /** Account tools that ran successfully this turn: account answers must come from their data. */
  accountToolsUsed?: number;
  /** Approved answers retrieved this turn; only these can be shown. */
  scenarios?: ScenarioHit[];
  /** Status of the bound account (null: not logged in), for approved answers with conditions. */
  accountStatus?: CustomerStatus | null;
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

  // An approved answer the model picked: its own text, word for word, only if it was retrieved
  // this turn and the customer's status allows it (checked here, never by the model).
  const approvedHit =
    answer.approvedAnswerId === null ||
    answer.intent === 'wants_human' ||
    answer.intent === 'off_topic'
      ? undefined
      : input.scenarios?.find((s) => s.versionId === answer.approvedAnswerId);
  if (approvedHit) {
    const status = input.accountStatus ?? null;
    if (approvedHit.statuses.length > 0 && status === null) {
      return fixed('bot.loginNeeded', 'login', 'unsupported', ['account_question']);
    }
    if (
      approvedHit.statuses.length > 0 &&
      status !== null &&
      !approvedHit.statuses.includes(status)
    ) {
      return fixed('bot.noMatch', 'ticket_form', 'no_match', ['no_match']);
    }
    return {
      text: lang === 'nl' ? approvedHit.answerNl : approvedHit.answerEn,
      lang,
      citations:
        approvedHit.article && approvedHit.articleId !== null
          ? [
              {
                articleId: approvedHit.articleId,
                title: approvedHit.article.title,
                url: approvedHit.article.url,
              },
            ]
          : [],
      action: 'none',
      outcome: 'answered',
      flags: [],
      scenarioVersionId: approvedHit.versionId,
    };
  }

  const hitsById = new Map(hits.map((hit) => [hit.articleId, hit]));
  if (answer.citedArticleIds.some((id) => !hitsById.has(id))) {
    return fixed('bot.noMatch', 'ticket_form', 'invalid_citation', ['invalid_citation']);
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
      if (!input.loggedIn)
        return fixed('bot.loginNeeded', 'login', 'unsupported', ['account_question']);
      // Only show the model's text when it is based on account data loaded this turn.
      return (input.accountToolsUsed ?? 0) > 0 && text
        ? { text, lang, citations: [], action: 'none', outcome: 'answered', flags: [] }
        : fixed('bot.accountQuestion', 'ticket_form', 'unsupported', ['account_question']);
    case 'wants_human':
      return fixed('bot.wantsHuman', 'ticket_form', 'handoff', ['wants_human']);
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
        return fixed(
          'bot.noMatch',
          'ticket_form',
          'no_match',
          flags.length > 0 ? flags : ['no_match'],
        );
      }
      return { text, lang, citations, action: 'none', outcome: 'answered', flags: [] };
    }
  }
}
