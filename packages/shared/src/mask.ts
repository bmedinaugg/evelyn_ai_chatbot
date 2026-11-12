const MASK = '[•••]';

const AT = String.raw`\s*(?:@|\[at\]|\(at\))\s*`;
const DOT = String.raw`\s*(?:\.|\[dot\]|\(dot\))\s*`;
// Also "jan @ gmail.com" and "jan [at] gmail [dot] com".
const EMAIL = new RegExp(String.raw`[\w.+-]+${AT}[\w-]+(?:${DOT}[\w-]+)*${DOT}[a-z]{2,}`, 'gi');
// Country code, check digits and 11-30 letters/digits, grouped by spaces, dots, dashes or slashes.
// Only masked with 10+ digits, so ordinary words ("is 12 euro meer") are never taken for one.
const IBAN_CANDIDATE =
  /\b[A-Z]{2}[\s./-]?\d{2}(?:[\s./-]?[A-Z0-9]{4}){2,7}(?:[\s./-]?[A-Z0-9]{1,3})?\b/gi;
// A run of digits with optional +, spaces, dots, dashes, slashes or brackets; a phone from 9 digits.
const PHONE_CANDIDATE = /\+?\d[\d\s./()-]{7,}\d/g;
// Customer, contract or card numbers.
const LONG_NUMBER = /\b\d{6,}\b/g;

const digits = (text: string) => text.replace(/\D/g, '').length;

/**
 * Masks personal data that can be recognised in free text (emails, phone numbers, IBANs, long
 * numbers) for review screens. Names cannot be recognised reliably; the original text is only
 * available through an audited request.
 */
export function maskText(text: string): string {
  return text
    .replace(EMAIL, MASK)
    .replace(IBAN_CANDIDATE, (match) => (digits(match) >= 10 ? MASK : match))
    .replace(PHONE_CANDIDATE, (match) => (digits(match) >= 9 ? MASK : match))
    .replace(LONG_NUMBER, MASK);
}
