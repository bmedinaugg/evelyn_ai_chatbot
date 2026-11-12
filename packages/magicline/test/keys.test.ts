import type { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { describe, expect, it } from 'vitest';
import {
  createSecretsManagerKeyResolver,
  createStaticKeyResolver,
  MagiclineKeyNotFoundError,
  parseKeyMap,
} from '../src/keys.ts';

describe('parseKeyMap', () => {
  it('parses cross and studio keys', () => {
    expect(parseKeyMap('cross:a, 1001:b,1002:c')).toEqual({
      crossStudio: 'a',
      studios: { 1001: 'b', 1002: 'c' },
    });
  });

  it('rejects malformed input', () => {
    expect(() => parseKeyMap('1001')).toThrow();
    expect(() => parseKeyMap('1001:b')).toThrow(/cross/);
    expect(() => parseKeyMap('cross:a,abc:b')).toThrow();
  });
});

describe('createStaticKeyResolver', () => {
  it('resolves keys and fails clearly for unknown studios', async () => {
    const keys = createStaticKeyResolver({ crossStudio: 'x', studios: { 1001: 'k1' } });
    expect(await keys.crossStudioKey()).toBe('x');
    expect(await keys.studioKey(1001)).toBe('k1');
    await expect(keys.studioKey(9)).rejects.toBeInstanceOf(MagiclineKeyNotFoundError);
  });
});

describe('createSecretsManagerKeyResolver', () => {
  function fakeClient(secret: string | undefined) {
    const commands: GetSecretValueCommand[] = [];
    return {
      commands,
      client: {
        async send(command: GetSecretValueCommand) {
          commands.push(command);
          return { SecretString: secret };
        },
      },
    };
  }

  it('reads the JSON secret once and caches it', async () => {
    const fake = fakeClient(JSON.stringify({ crossStudio: 'x', studios: { '1001': 'k1' } }));
    let now = 0;
    const keys = createSecretsManagerKeyResolver({
      client: fake.client,
      secretName: 's',
      ttlMs: 1000,
      now: () => now,
    });
    expect(await keys.studioKey(1001)).toBe('k1');
    expect(await keys.crossStudioKey()).toBe('x');
    expect(fake.commands).toHaveLength(1);
    expect(fake.commands[0]?.input).toEqual({ SecretId: 's' });
    now = 1001;
    await keys.crossStudioKey();
    expect(fake.commands).toHaveLength(2);
  });

  it('rejects a malformed secret without echoing it', async () => {
    const keys = createSecretsManagerKeyResolver({
      client: fakeClient('{"crossStudio": "secret-value"').client,
      secretName: 's',
    });
    const error = await keys.crossStudioKey().catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error.message)).not.toContain('secret-value');
  });
});
