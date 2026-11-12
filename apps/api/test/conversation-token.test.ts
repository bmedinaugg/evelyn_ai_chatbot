import { describe, expect, it } from 'vitest';
import { newConversationToken, tokenMatches } from '../src/conversation-token.ts';

describe('conversation tokens', () => {
  it('creates a random token and stores only its hash', () => {
    const a = newConversationToken();
    const b = newConversationToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
  });

  it('matches only the right token', () => {
    const { token, tokenHash } = newConversationToken();
    expect(tokenMatches(token, tokenHash)).toBe(true);
    expect(tokenMatches(newConversationToken().token, tokenHash)).toBe(false);
  });

  it('is false for malformed input', () => {
    const { tokenHash } = newConversationToken();
    expect(tokenMatches('', tokenHash)).toBe(false);
    expect(tokenMatches('not base64 !!', tokenHash)).toBe(false);
    expect(tokenMatches('abc', 'short-hash')).toBe(false);
  });
});
