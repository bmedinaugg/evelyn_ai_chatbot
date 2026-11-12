import { describe, expect, it } from 'vitest';
import { en } from '../src/en.ts';
import { isLang, t } from '../src/index.ts';
import { nl } from '../src/nl.ts';
import { flatKeys, flatValues } from './helpers.ts';

describe('messages', () => {
  it('has identical key sets in nl and en', () => {
    expect(flatKeys(nl)).toEqual(flatKeys(en));
  });

  it('has no empty strings', () => {
    expect([...flatValues(nl), ...flatValues(en)].every((v) => v.trim() !== '')).toBe(true);
  });
});

describe('t', () => {
  it('translates', () => {
    expect(t('nl', 'common.error.generic')).toBe('Er ging iets mis. Probeer het opnieuw.');
  });

  it('interpolates', () => {
    expect(t('en', 'common.greeting', { name: 'Sam' })).toBe('Hi Sam!');
  });

  it('throws on a missing param', () => {
    expect(() => t('en', 'common.greeting')).toThrow(/name/);
  });
});

describe('isLang', () => {
  it('accepts nl and en only', () => {
    expect(isLang('nl')).toBe(true);
    expect(isLang('en')).toBe(true);
    expect(isLang('de')).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });
});

describe('bot texts', () => {
  it('has the fixed nl/en bot texts', () => {
    expect(t('nl', 'bot.noMatch')).toBe(
      'Ik kon hier geen betrouwbaar antwoord op vinden in onze helpartikelen. Ons supportteam helpt je graag verder.',
    );
    expect(t('en', 'bot.offTopic')).toBe(
      'I can only help with questions about TrainMore. Is there something about your membership or our clubs I can help with?',
    );
    expect(t('en', 'lead.subject')).toBe('New membership question via website chat');
  });

  it('points hand-offs to the ticket form in both languages', () => {
    expect(t('en', 'bot.stuck')).toBe(
      "Sorry, I can't seem to help you with this. Fill in the form below and our support team will get back to you by email.",
    );
    expect(t('nl', 'bot.stuck')).toBe(
      'Sorry, ik kom er niet uit. Vul het formulier hieronder in, dan neemt ons supportteam per e-mail contact met je op.',
    );
    expect(t('en', 'bot.wantsHuman')).toBe(
      'Of course. Fill in the form below and our support team will get back to you by email.',
    );
    expect(t('nl', 'bot.wantsHuman')).toBe(
      'Natuurlijk. Vul het formulier hieronder in, dan neemt ons supportteam per e-mail contact met je op.',
    );
  });
});

describe('widget texts', () => {
  it('has the widget texts in both languages', () => {
    expect(t('en', 'widget.consent.accept')).toBe('I understand, start chat');
    expect(t('nl', 'widget.consent.accept')).toBe('Begrepen, start de chat');
    expect(t('nl', 'widget.input.placeholder')).toBe('Stel je vraag…');
    expect(t('en', 'widget.lead.success')).toBe(
      "Thanks! We've received your question and will get back to you by email.",
    );
  });
});
