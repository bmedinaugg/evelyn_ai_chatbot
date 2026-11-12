import { describe, expect, it } from 'vitest';
import { isLocalMagicline } from '../src/safety.ts';

describe('isLocalMagicline', () => {
  it('only accepts a mock server on this machine', () => {
    expect(isLocalMagicline('http://localhost:4010')).toBe(true);
    expect(isLocalMagicline('http://127.0.0.1:4010/')).toBe(true);
    expect(isLocalMagicline('https://trainmore.open-api.magicline.com/v1')).toBe(false);
    expect(isLocalMagicline('http://localhost.evil.example')).toBe(false);
    expect(isLocalMagicline('not a url')).toBe(false);
  });
});
