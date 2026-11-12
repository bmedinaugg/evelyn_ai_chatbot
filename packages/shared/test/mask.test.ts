import { describe, expect, it } from 'vitest';
import { maskText } from '../src/mask.ts';

describe('maskText', () => {
  it('masks emails, phone numbers, IBANs and long number runs', () => {
    expect(
      maskText(
        'Mail sam.de.vries@example.com of bel +31 6 1234 5678. IBAN NL91 ABNA 0417 1643 00, klantnummer 1234567.',
      ),
    ).toBe('Mail [•••] of bel [•••]. IBAN [•••], klantnummer [•••].');
  });

  it('keeps ordinary text, prices, dates and short numbers', () => {
    const text = 'Ik betaal €29,99 per maand sinds 12-03-2026, club 1001, 6 maanden.';
    expect(maskText(text)).toBe(text);
  });

  it('masks an IBAN written without spaces', () => {
    expect(maskText('NL91ABNA0417164300')).toBe('[•••]');
  });
});
