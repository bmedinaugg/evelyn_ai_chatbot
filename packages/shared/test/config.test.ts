import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';

const base = {
  NODE_ENV: 'test',
  APP_ENV: 'local',
  AWS_REGION: 'eu-west-1',
  MAGICLINE_BASE_URL: 'http://localhost:4010',
  MAGICLINE_USE_MOCK: 'true',
};

describe('loadConfig', () => {
  it('parses a valid env', () => {
    expect(loadConfig(base)).toEqual({
      nodeEnv: 'test',
      appEnv: 'local',
      awsRegion: 'eu-west-1',
      logLevel: 'info',
      magicline: { baseUrl: 'http://localhost:4010', useMock: true },
    });
  });

  it('parses "false" and "0" as false', () => {
    expect(
      loadConfig({ ...base, APP_ENV: 'prod', MAGICLINE_USE_MOCK: 'false' }).magicline.useMock,
    ).toBe(false);
    expect(
      loadConfig({ ...base, APP_ENV: 'prod', MAGICLINE_USE_MOCK: '0' }).magicline.useMock,
    ).toBe(false);
  });

  it('rejects a non-boolean string', () => {
    expect(() => loadConfig({ ...base, MAGICLINE_USE_MOCK: 'yes' })).toThrow(ConfigError);
  });

  it('requires the mock outside prod', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'preprod', MAGICLINE_USE_MOCK: 'false' })).toThrow(
      /MAGICLINE_USE_MOCK must be true/,
    );
  });

  it('forbids the mock in prod', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'prod' })).toThrow(
      /MAGICLINE_USE_MOCK must be false/,
    );
  });

  it('names missing keys without echoing values', () => {
    const { MAGICLINE_BASE_URL: _omitted, ...rest } = base;
    let err: ConfigError | undefined;
    try {
      loadConfig({ ...rest, NODE_ENV: 'secret-ish-value' });
    } catch (e) {
      err = e as ConfigError;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err?.message).toContain('MAGICLINE_BASE_URL');
    expect(err?.message).toContain('NODE_ENV');
    expect(err?.message).not.toContain('secret-ish-value');
  });
});
