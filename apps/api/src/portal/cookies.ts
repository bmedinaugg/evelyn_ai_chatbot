import { createHmac, timingSafeEqual } from 'node:crypto';

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(index + 1).trim());
  }
  return cookies;
}

/** Always HttpOnly and Secure (browsers accept Secure cookies on http://localhost too). */
export function serializeCookie(
  name: string,
  value: string,
  options: { path: string; maxAgeSeconds: number; sameSite: 'Strict' | 'Lax' },
): string {
  return `${name}=${value}; Path=${options.path}; Max-Age=${options.maxAgeSeconds}; HttpOnly; Secure; SameSite=${options.sameSite}`;
}

function mac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** `payload.signature` (HMAC-SHA256); the payload is JSON with an expiry. */
export function signValue(value: object, secret: string, expiresAt: Date): string {
  const payload = Buffer.from(JSON.stringify({ ...value, exp: expiresAt.getTime() })).toString(
    'base64url',
  );
  return `${payload}.${mac(payload, secret)}`;
}

/** The payload when the signature is valid and it has not expired; otherwise null. */
export function verifySignedValue(signed: string | undefined, secret: string): unknown {
  if (!signed) return null;
  const [payload, signature, ...rest] = signed.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof value !== 'object' || value === null) return null;
    const exp = (value as { exp?: unknown }).exp;
    return typeof exp === 'number' && exp > Date.now() ? value : null;
  } catch {
    return null;
  }
}
