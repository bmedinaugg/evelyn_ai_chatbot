import type { Reply } from '@trainmore/core';
import { describe, expect, it } from 'vitest';
import { checkReply } from '../src/assertions.ts';

const reply: Reply = {
  text: 'Je kunt opzeggen via de app.',
  lang: 'nl',
  citations: [{ articleId: 900101, title: 'Opzeggen', url: 'https://x/900101' }],
  action: 'none',
  outcome: 'answered',
  flags: [],
};

describe('checkReply', () => {
  it('passes when every expectation holds', () => {
    expect(
      checkReply(reply, {
        outcome: ['answered'],
        action: 'none',
        citesAnyOf: [900101, 900102],
        replyLang: 'nl',
        mustNotMatch: [/€/],
      }),
    ).toEqual([]);
  });

  it('reports each failed expectation', () => {
    const failures = checkReply(reply, {
      outcome: ['no_match'],
      action: 'ticket_form',
      citesAnyOf: [900103],
      replyLang: 'en',
      mustNotMatch: [/opzeggen/],
    });
    expect(failures).toHaveLength(5);
    expect(failures.join('\n')).toMatch(/outcome/);
  });

  it('citesNone fails when anything is cited', () => {
    expect(checkReply(reply, { citesNone: true })).toHaveLength(1);
    expect(checkReply({ ...reply, citations: [] }, { citesNone: true })).toEqual([]);
  });

  it('mustMatch requires each pattern in the reply text', () => {
    expect(checkReply(reply, { mustMatch: [/opzeggen/, /app/] })).toEqual([]);
    expect(checkReply(reply, { mustMatch: [/2027/] })).toHaveLength(1);
  });

  it('mustNotMatch also checks citation titles and urls', () => {
    expect(checkReply(reply, { mustNotMatch: [/x\/900101/] })).toHaveLength(1);
  });
});
