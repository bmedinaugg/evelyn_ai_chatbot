import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 256-bit bearer token for one conversation; only its sha256 is stored. */
export function newConversationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function tokenMatches(token: string, tokenHash: string): boolean {
  if (!TOKEN_PATTERN.test(token)) return false;
  const actual = Buffer.from(hashToken(token));
  const expected = Buffer.from(tokenHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
