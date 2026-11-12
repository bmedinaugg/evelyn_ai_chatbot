import { describe, expect, it } from 'vitest';
import { detectPortalLang } from '../src/lib/lang.ts';
import { safeHttpsUrl } from '../src/lib/urls.ts';

describe('detectPortalLang', () => {
  it('reads the language from the portal path', () => {
    expect(detectPortalLang('/nl/support/home', null)).toBe('nl');
    expect(detectPortalLang('/en/support/solutions/articles/1', 'nl')).toBe('en');
    expect(detectPortalLang('/NL/support', null)).toBe('nl');
  });

  it('falls back to <html lang>, then Dutch', () => {
    expect(detectPortalLang('/en-us/support', 'en-GB')).toBe('en');
    expect(detectPortalLang('/', 'nl-NL')).toBe('nl');
    expect(detectPortalLang('/', 'de')).toBe('nl');
    expect(detectPortalLang('/', null)).toBe('nl');
  });
});

describe('safeHttpsUrl', () => {
  it('keeps https URLs', () => {
    expect(safeHttpsUrl('https://www.support.trainmore.com/nl/support/solutions/articles/1')).toBe(
      'https://www.support.trainmore.com/nl/support/solutions/articles/1',
    );
  });

  it('drops anything else', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://x.example',
      'data:text/html,x',
      '//evil.example',
      '',
      42,
      null,
    ]) {
      expect(safeHttpsUrl(url)).toBeNull();
    }
  });
});
