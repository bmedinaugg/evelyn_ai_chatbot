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
