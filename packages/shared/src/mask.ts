const MASK = '[•••]';

const EMAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi;
// Country code, check digits, then 11-30 letters/digits, optionally grouped by four.
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/gi;
// A run of digits with optional +, spaces or dashes; a phone number from 9 digits on.
const PHONE_CANDIDATE = /\+?\d[\d\s-]{7,}\d/g;
// Customer, contract or card numbers.
const LONG_NUMBER = /\b\d{6,}\b/g;

/**
 * Masks personal data that can be recognised in free text (emails, phone numbers, IBANs, long
 * numbers) for review screens. Names cannot be recognised reliably; the original text is only
 * available through an audited request.
 */
export function maskText(text: string): string {
  return text
    .replace(EMAIL, MASK)
    .replace(IBAN, MASK)
    .replace(PHONE_CANDIDATE, (match) => (match.replace(/\D/g, '').length >= 9 ? MASK : match))
    .replace(LONG_NUMBER, MASK);
}
