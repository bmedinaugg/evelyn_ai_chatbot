const REDACTED = '[redacted]';

/** Keys whose values are never logged (compared lower-case). Includes Magicline field names. */
export const PII_KEYS: ReadonlySet<string> = new Set([
  'email',
  'phone',
  'name',
  'firstname',
  'lastname',
  'secondfirstname',
  'secondlastname',
  'phoneprivate',
  'phoneprivatemobile',
  'phonebusiness',
  'phonebusinessmobile',
  'street',
  'housenumber',
  'zipcode',
  'city',
  'dateofbirth',
  'bankaccount',
  'iban',
  'password',
  'otp',
  'code',
  'token',
  'authorization',
  'x-api-key',
  'apikey',
]);

const EMAIL_PATTERN = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi;
// A run of digits with optional leading +, spaces or dashes; only treated as a phone at 9+ digits.
const PHONE_CANDIDATE = /\+?\d[\d\s-]{7,}\d/g;

export function scrubText(text: string): string {
  return text
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_CANDIDATE, (match) => (match.replace(/\D/g, '').length >= 9 ? REDACTED : match));
}

export function redactDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = PII_KEYS.has(key.toLowerCase()) ? REDACTED : redactDeep(inner, seen);
  }
  return result;
}
