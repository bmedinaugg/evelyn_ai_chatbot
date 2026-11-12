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

  it('masks dotted and slashed phone numbers', () => {
    expect(maskText('bel 06.12.34.56.78')).toBe('bel [•••]');
    expect(maskText('bel 020/123 45 67')).toBe('bel [•••]');
  });

  it('masks IBANs with dots or a space after the country code, entirely', () => {
    expect(maskText('NL91.ABNA.0417.1643.00')).toBe('[•••]');
    expect(maskText('NL 91 ABNA 0417 1643 00')).toBe('[•••]');
  });

  it('masks spaced or written-out email addresses', () => {
    expect(maskText('mail jan @ gmail.com')).toBe('mail [•••]');
    expect(maskText('mail jan [at] gmail [dot] com')).toBe('mail [•••]');
  });

  it('does not mistake ordinary words and numbers for an IBAN or phone number', () => {
    for (const text of [
      'Is 12 euro meer of minder dan vorige maand?',
      'Op 12.03.2026 om 10.30 uur',
      'Kost €1.299,00 per jaar',
    ]) {
      expect(maskText(text)).toBe(text);
    }
  });
});
