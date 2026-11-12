import { stdSerializers } from 'pino';

const REDACTED = '[redacted]';

/** Keys redacted when they match exactly (lower-cased, `_`/`-` removed); too short to match as substrings. */
const PII_EXACT_KEYS: ReadonlySet<string> = new Set([
  'name',
  'city',
  'mobile',
  'otp',
  'pin',
  'dob',
  'token',
  'xapikey',
]);

/** Keys redacted when they contain one of these parts. Includes Magicline field names. */
const PII_KEY_PARTS: readonly string[] = [
  'email',
  'phone',
  'firstname',
  'lastname',
  'fullname',
  'surname',
  'displayname',
  'customername',
  'street',
  'address',
  'housenumber',
  'zipcode',
  'postcode',
  'postalcode',
  'birth',
  'iban',
  'bankaccount',
  'password',
  'passcode',
  'otpcode',
  'apikey',
  'authorization',
  'cookie',
  'secret',
  'accesstoken',
  'sessiontoken',
  'refreshtoken',
  'idtoken',
];

/** Keys that are never PII in their context (error metadata, the logger's own name). */
type KeyContext = { allowName: boolean };

export function isPiiKey(key: string, context: KeyContext = { allowName: false }): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  if (normalized === 'name' && context.allowName) return false;
  return PII_EXACT_KEYS.has(normalized) || PII_KEY_PARTS.some((part) => normalized.includes(part));
}

const EMAIL_PATTERN = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi;
// A run of digits with optional leading +, spaces or dashes; only treated as a phone at 9+ digits.
const PHONE_CANDIDATE = /\+?\d[\d\s-]{7,}\d/g;

export function scrubText(text: string): string {
  return text
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_CANDIDATE, (match) => (match.replace(/\D/g, '').length >= 9 ? REDACTED : match));
}

type Serializer = (value: unknown) => unknown;

/** Request: method and path only (no query string, headers, IP or body). */
function serializeRequest(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const { method, url } = value as { method?: unknown; url?: unknown };
  return {
    method: typeof method === 'string' ? method : undefined,
    url: typeof url === 'string' ? url.split('?')[0] : undefined,
  };
}

function serializeResponse(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const { statusCode } = value as { statusCode?: unknown };
  return { statusCode: typeof statusCode === 'number' ? statusCode : undefined };
}

/** Applied before redaction, because pino runs its own serializers after `formatters.log`. */
export const LOG_SERIALIZERS: Readonly<Record<string, Serializer>> = {
  req: serializeRequest,
  res: serializeResponse,
};

export function redactDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Error) {
    // `type`, `message`, `stack`, `cause` and own props such as `code`; `name` is the error class here.
    return redactObject(stdSerializers.errWithCause(value) as object, seen, { allowName: true });
  }
  if (value instanceof Map) return redactDeep(Object.fromEntries(value), seen);
  if (value instanceof Set) return redactDeep([...value], seen);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, seen));
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    // Date, URL, Buffer and friends.
    return redactDeep(toJSON.call(value), seen);
  }
  return redactObject(value, seen, { allowName: false });
}

function redactObject(value: object, seen: WeakSet<object>, context: KeyContext): unknown {
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = isPiiKey(key, context) ? REDACTED : redactDeep(inner, seen);
  }
  return result;
}

/** Applies LOG_SERIALIZERS to top-level keys, then redacts the whole object. */
export function redactLogObject(object: Record<string, unknown>): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    const serializer = LOG_SERIALIZERS[key];
    serialized[key] = serializer ? serializer(value) : value;
  }
  return redactDeep(serialized) as Record<string, unknown>;
}
