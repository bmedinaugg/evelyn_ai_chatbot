import { describe, expect, it } from 'vitest';
import { loadEmailConfig, loadMagiclineKeysConfig, loadOtpConfig } from '../src/config-sections.ts';

const secret = 'x'.repeat(32);

describe('loadOtpConfig', () => {
  it('defaults expiry and attempts', () => {
    expect(loadOtpConfig({ OTP_HMAC_SECRET: secret })).toEqual({
      secret,
      ttlSeconds: 300,
      maxAttempts: 5,
      maxPerWindow: 3,
      windowSeconds: 900,
    });
  });

  it('requires a long secret and sane limits, without echoing the secret', () => {
    expect(() => loadOtpConfig({ OTP_HMAC_SECRET: 'short-secret' })).toThrow(/OTP_HMAC_SECRET/);
    expect(() => loadOtpConfig({ OTP_HMAC_SECRET: 'short-secret' })).not.toThrow(/short-secret/);
    expect(() => loadOtpConfig({ OTP_HMAC_SECRET: secret, OTP_EXPIRY_SECONDS: '3600' })).toThrow(
      /OTP_EXPIRY_SECONDS/,
    );
    expect(() => loadOtpConfig({ OTP_HMAC_SECRET: secret, OTP_MAX_ATTEMPTS: '50' })).toThrow(
      /OTP_MAX_ATTEMPTS/,
    );
  });
});

describe('loadEmailConfig', () => {
  it('needs a sender address', () => {
    expect(loadEmailConfig({ EMAIL_FROM: 'TrainMore <no-reply@example.com>' })).toEqual({
      from: 'TrainMore <no-reply@example.com>',
    });
    expect(() => loadEmailConfig({})).toThrow(/EMAIL_FROM/);
  });
});

describe('loadMagiclineKeysConfig', () => {
  it('uses env keys with the mock and Secrets Manager otherwise', () => {
    expect(
      loadMagiclineKeysConfig({
        MAGICLINE_USE_MOCK: 'true',
        MOCK_MAGICLINE_KEYS: 'cross:a,1001:b',
      }),
    ).toEqual({
      kind: 'env',
      raw: 'cross:a,1001:b',
    });
    expect(
      loadMagiclineKeysConfig({
        MAGICLINE_USE_MOCK: 'false',
        MAGICLINE_KEYS_SECRET_NAME: 'trainmore-chatbot/prod/magicline-keys',
      }),
    ).toEqual({
      kind: 'secret',
      secretName: 'trainmore-chatbot/prod/magicline-keys',
    });
    expect(() => loadMagiclineKeysConfig({ MAGICLINE_USE_MOCK: 'false' })).toThrow(
      /MAGICLINE_KEYS_SECRET_NAME/,
    );
  });
});
