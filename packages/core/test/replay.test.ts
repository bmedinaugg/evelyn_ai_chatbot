import { Writable } from 'node:stream';
import type { ScenarioHit } from '@trainmore/db';
import { createLogger } from '@trainmore/shared';
import { describe, expect, it } from 'vitest';
import type { Answer } from '../src/answer-schema.ts';
import type { Answerer } from '../src/claude-answerer.ts';
import { MAX_REPLAY_QUESTIONS, REPLAY_PROFILES, replayConversation } from '../src/replay.ts';
import { fakeFaq } from './fakes.ts';
import { cancelNl } from './hits.ts';

const logger = createLogger({
  name: 'test',
  level: 'fatal',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});

const draft: ScenarioHit = {
  versionId: 77,
  scenarioId: '00000000-0000-4000-8000-0000000000dd',
  triggers: ['Mag mijn hond mee?'],
  answerNl: 'Huisdieren zijn niet toegestaan.',
  answerEn: 'Pets are not allowed.',
  statuses: [],
  articleId: null,
  article: null,
};

function fakeAnswerer(pick: number | null) {
  const calls: Parameters<Answerer>[0][] = [];
  const answerer: Answerer = async (input) => {
    calls.push(input);
    const answer: Answer = {
      language: 'nl',
      intent: 'faq',
      answer: 'Model antwoord.',
      citedArticleIds: [],
      confidence: 'high',
      needsHuman: false,
      approvedAnswerId: pick,
    };
    return {
      kind: 'answer',
      answer,
      assistantContent: [{ type: 'text', text: JSON.stringify(answer) }],
      steps: [],
      toolsUsed: [],
    };
  };
  return { answerer, calls };
}

const capabilities = {
  deps: {
    studioClient: async () => ({}) as never,
    crossStudioClient: async () => ({}) as never,
    today: () => new Date('2026-11-12T10:00:00Z'),
  },
  disabled: async () => new Set<string>(),
};

describe('replayConversation', () => {
  it('re-asks every question with the draft offered and shows it when Claude picks it', async () => {
    const { answerer, calls } = fakeAnswerer(77);
    const result = await replayConversation(
      {
        faq: fakeFaq([cancelNl]),
        scenarios: { search: async () => [] },
        answerer,
        capabilities,
        logger,
      },
      { questions: ['Mag mijn hond mee?', 'En mijn kat?'], pageLang: 'nl', status: null, draft },
    );
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.userTurn).toContain('<approved_answer id="77">');
    expect(result.map((r) => r.reply.text)).toEqual([
      'Huisdieren zijn niet toegestaan.',
      'Huisdieren zijn niet toegestaan.',
    ]);
    // The second question sees the first one in its (in-memory) history.
    expect(calls[1]?.history).toHaveLength(2);
  });

  it('puts the draft in place of the live version of the same scenario', async () => {
    const { answerer, calls } = fakeAnswerer(null);
    const live = { ...draft, versionId: 76, answerNl: 'Oude tekst.' };
    await replayConversation(
      {
        faq: fakeFaq([]),
        scenarios: { search: async () => [live] },
        answerer,
        capabilities,
        logger,
      },
      { questions: ['Hond?'], pageLang: 'nl', status: null, draft },
    );
    expect(calls[0]?.userTurn).toContain('id="77"');
    expect(calls[0]?.userTurn).not.toContain('id="76"');
  });

  it('answers at most the first questions and stores nothing', async () => {
    const { answerer, calls } = fakeAnswerer(null);
    const questions = Array.from({ length: MAX_REPLAY_QUESTIONS + 3 }, (_, i) => `Vraag ${i}`);
    const result = await replayConversation(
      { faq: fakeFaq([]), scenarios: { search: async () => [] }, answerer, capabilities, logger },
      { questions, pageLang: 'nl', status: null, draft },
    );
    expect(result).toHaveLength(MAX_REPLAY_QUESTIONS);
    expect(calls).toHaveLength(MAX_REPLAY_QUESTIONS);
  });

  it('offers account tools only for a logged-in status, as its synthetic profile', async () => {
    const anonymous = fakeAnswerer(null);
    await replayConversation(
      {
        faq: fakeFaq([]),
        scenarios: { search: async () => [] },
        answerer: anonymous.answerer,
        capabilities,
        logger,
      },
      { questions: ['Wanneer eindigt mijn contract?'], pageLang: 'nl', status: null, draft },
    );
    expect(anonymous.calls[0]?.tools).toBeUndefined();

    const member = fakeAnswerer(null);
    await replayConversation(
      {
        faq: fakeFaq([]),
        scenarios: { search: async () => [] },
        answerer: member.answerer,
        capabilities,
        logger,
      },
      { questions: ['Wanneer eindigt mijn contract?'], pageLang: 'nl', status: 'MEMBER', draft },
    );
    expect(member.calls[0]?.tools?.definitions.map((d) => d.name)).toContain('get_memberships');
    expect(REPLAY_PROFILES.MEMBER).toEqual({ customerId: 1, studioId: 1001, status: 'MEMBER' });
  });

  it('applies the same members-only rule as the live bot', async () => {
    const { answerer, calls } = fakeAnswerer(null);
    await replayConversation(
      { faq: fakeFaq([]), scenarios: { search: async () => [] }, answerer, capabilities, logger },
      {
        questions: ['Overzetten?'],
        pageLang: 'nl',
        status: 'PROSPECT',
        draft: { ...draft, statuses: ['MEMBER'], answerNl: 'GEHEIM' },
      },
    );
    expect(calls[0]?.userTurn).not.toContain('GEHEIM');
  });
});
