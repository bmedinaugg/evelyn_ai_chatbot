import type { CustomerStatus, ScenarioHit } from '@trainmore/db';
import { describe, expect, it } from 'vitest';
import type { Answer } from '../src/answer-schema.ts';
import { finalizeReply } from '../src/finalize-reply.ts';
import { cancelNl, lockersNl } from './hits.ts';

const base: Answer = {
  language: 'en',
  intent: 'faq',
  answer: 'You can cancel in the app.',
  citedArticleIds: [900101],
  confidence: 'high',
  needsHuman: false,
  approvedAnswerId: null,
};
const hits = [cancelNl, lockersNl];
const reply = (answer: Partial<Answer>, loggedIn = false, accountToolsUsed = 0) =>
  finalizeReply({ answer: { ...base, ...answer }, hits, loggedIn, accountToolsUsed });

const freeze: ScenarioHit = {
  versionId: 41,
  scenarioId: '00000000-0000-4000-8000-0000000000aa',
  triggers: ['Can I freeze during pregnancy?'],
  answerNl: 'Ja, bij zwangerschap kun je tot 6 maanden bevriezen.',
  answerEn: 'Yes, during pregnancy you can freeze for up to 6 months.',
  statuses: [],
  articleId: 7,
  article: {
    title: 'How to freeze',
    url: 'https://www.support.trainmore.com/en/support/solutions/articles/7',
  },
};
const approved = (
  answer: Partial<Answer>,
  options: { scenarios?: ScenarioHit[]; accountStatus?: CustomerStatus | null } = {},
) =>
  finalizeReply({
    answer: { ...base, approvedAnswerId: 41, ...answer },
    hits,
    loggedIn: options.accountStatus != null,
    accountToolsUsed: 0,
    scenarios: options.scenarios ?? [freeze],
    accountStatus: options.accountStatus ?? null,
  });

describe('finalizeReply', () => {
  it('answers an FAQ with citations from the hits (fallback-language hit kept as is)', () => {
    expect(reply({})).toEqual({
      text: 'You can cancel in the app.',
      lang: 'en',
      citations: [{ articleId: 900101, title: cancelNl.title, url: cancelNl.url }],
      action: 'none',
      outcome: 'answered',
      flags: [],
    });
  });

  it('rejects a citation that was not retrieved', () => {
    expect(reply({ citedArticleIds: [900101, 123] })).toMatchObject({
      outcome: 'invalid_citation',
      action: 'ticket_form',
      flags: ['invalid_citation'],
      citations: [],
      text: "I couldn't find a reliable answer to that in our help articles. Our support team can help you further.",
    });
  });

  it('an invalid citation wins over a sales lead', () => {
    expect(reply({ intent: 'sales_lead', citedArticleIds: [999] }).outcome).toBe(
      'invalid_citation',
    );
  });

  it('declines off-topic questions with the fixed text', () => {
    expect(reply({ intent: 'off_topic', language: 'nl', answer: 'Here is a poem' })).toMatchObject({
      outcome: 'declined',
      action: 'none',
      citations: [],
      text: 'Ik kan alleen helpen met vragen over TrainMore. Kan ik je helpen met iets over je lidmaatschap of onze clubs?',
    });
  });

  it('asks anonymous visitors to log in for account questions', () => {
    expect(reply({ intent: 'account_question' })).toMatchObject({
      outcome: 'unsupported',
      action: 'login',
      flags: ['account_question'],
      text: 'To answer questions about your account, please log in first with your email address.',
    });
  });

  it('answers account questions from account data when a tool ran this turn', () => {
    expect(
      reply(
        {
          intent: 'account_question',
          answer: 'Je contract loopt tot 31 januari 2027.',
          citedArticleIds: [],
        },
        true,
        1,
      ),
    ).toEqual({
      text: 'Je contract loopt tot 31 januari 2027.',
      lang: 'en',
      citations: [],
      action: 'none',
      outcome: 'answered',
      flags: [],
    });
  });

  it('hands account questions of logged-in customers to support when no tool ran', () => {
    expect(reply({ intent: 'account_question' }, true)).toMatchObject({
      outcome: 'unsupported',
      action: 'ticket_form',
      flags: ['account_question'],
    });
  });

  it('hands off when the customer wants a human', () => {
    expect(reply({ intent: 'wants_human' })).toMatchObject({
      outcome: 'handoff',
      action: 'ticket_form',
      flags: ['wants_human'],
    });
  });

  it('answers greetings with the fixed greeting, never model text', () => {
    expect(
      reply({ intent: 'greeting', answer: 'Hi! Memberships cost €10.', citedArticleIds: [] }),
    ).toMatchObject({
      outcome: 'answered',
      citations: [],
      action: 'none',
      text: 'Hi! How can I help you today?',
    });
  });

  it('sales questions without a cited article get the fixed lead text (no invented prices)', () => {
    expect(
      reply({ intent: 'sales_lead', answer: 'Membership is €24.99 a month!', citedArticleIds: [] }),
    ).toMatchObject({
      outcome: 'answered',
      action: 'lead_form',
      citations: [],
      text: "Great that you're interested in joining TrainMore! Leave your details in the form below and our team will contact you.",
    });
    expect(reply({ intent: 'sales_lead', confidence: 'low' }).text).toMatch(
      /^Great that you're interested/,
    );
  });

  it('offers the lead form for sales questions', () => {
    expect(reply({ intent: 'sales_lead' })).toMatchObject({
      outcome: 'answered',
      action: 'lead_form',
    });
  });

  it('hands off an FAQ without citations, with low confidence or needing a human', () => {
    expect(reply({ citedArticleIds: [] })).toMatchObject({
      outcome: 'no_match',
      flags: ['no_match'],
    });
    expect(reply({ confidence: 'low' })).toMatchObject({
      outcome: 'no_match',
      flags: ['low_confidence'],
    });
    expect(reply({ citedArticleIds: [], confidence: 'low', needsHuman: true }).flags).toEqual([
      'no_match',
      'low_confidence',
      'needs_human',
    ]);
  });

  it('strips URLs and markdown links from model text', () => {
    expect(
      reply({
        answer:
          'See [the app](https://evil.example/x) or https://evil.example and www.evil.example now.',
      }).text,
    ).toBe('See the app or and now.');
  });

  it('dedupes citations in cited order', () => {
    expect(
      reply({ citedArticleIds: [900107, 900101, 900107] }).citations.map((c) => c.articleId),
    ).toEqual([900107, 900101]);
  });

  it('hands off when the text is empty after sanitising', () => {
    expect(reply({ answer: 'https://only.a.link' })).toMatchObject({ outcome: 'no_match' });
  });
});

describe('finalizeReply with approved answers', () => {
  it('shows the approved text word for word, with its linked article', () => {
    expect(
      approved({ answer: 'Model wording that must not be shown', citedArticleIds: [900101] }),
    ).toEqual({
      text: 'Yes, during pregnancy you can freeze for up to 6 months.',
      lang: 'en',
      citations: [
        {
          articleId: 7,
          title: 'How to freeze',
          url: 'https://www.support.trainmore.com/en/support/solutions/articles/7',
        },
      ],
      action: 'none',
      outcome: 'answered',
      flags: [],
      scenarioVersionId: 41,
    });
  });

  it('uses the Dutch approved text for a Dutch reply', () => {
    expect(approved({ language: 'nl' }).text).toBe(
      'Ja, bij zwangerschap kun je tot 6 maanden bevriezen.',
    );
  });

  it('ignores an approved answer that was not retrieved this turn', () => {
    const result = approved({ approvedAnswerId: 999 });
    expect(result.text).toBe('You can cancel in the app.');
    expect(result.scenarioVersionId).toBeUndefined();
  });

  it('asks to log in first for an answer limited to members', () => {
    const membersOnly = { ...freeze, statuses: ['MEMBER' as const] };
    expect(approved({}, { scenarios: [membersOnly] })).toMatchObject({
      action: 'login',
      text: 'To answer questions about your account, please log in first with your email address.',
    });
  });

  it('never shows a members-only answer to a prospect', () => {
    const membersOnly = { ...freeze, statuses: ['MEMBER' as const] };
    const result = approved({}, { scenarios: [membersOnly], accountStatus: 'PROSPECT' });
    expect(result).toMatchObject({ action: 'ticket_form', outcome: 'no_match' });
    expect(result.scenarioVersionId).toBeUndefined();
  });

  it('shows a members-only answer to a logged-in member', () => {
    const membersOnly = { ...freeze, statuses: ['MEMBER' as const] };
    expect(
      approved({}, { scenarios: [membersOnly], accountStatus: 'MEMBER' }).scenarioVersionId,
    ).toBe(41);
  });

  it('a request for a person or an off-topic question wins over an approved answer', () => {
    expect(approved({ intent: 'wants_human' }).outcome).toBe('handoff');
    expect(approved({ intent: 'off_topic' }).outcome).toBe('declined');
  });
});
