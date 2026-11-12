import { describe, expect, it } from 'vitest';
import type { ConfigError } from '../src/config.ts';
import { loadApiConfig, loadClaudeConfig, loadTurnstileConfig } from '../src/config-sections.ts';

const api = {
  APP_ENV: 'preprod',
  WIDGET_ALLOWED_ORIGINS: 'https://www.support.trainmore.com',
  SUPPORT_CONTACT_URL: 'https://www.support.trainmore.com/en/support/tickets/new',
};

describe('loadClaudeConfig', () => {
  it('defaults to Claude Sonnet 5.5', () => {
    expect(loadClaudeConfig({})).toEqual({ chatModel: 'claude-sonnet-5-5' });
  });

  it('rejects a non-Claude model', () => {
    expect(() => loadClaudeConfig({ CLAUDE_CHAT_MODEL: 'gpt-4o' })).toThrow(/CLAUDE_CHAT_MODEL/);
  });
});

describe('loadApiConfig', () => {
  it('parses origins with spaces and defaults the port', () => {
    expect(
      loadApiConfig({
        ...api,
        WIDGET_ALLOWED_ORIGINS: ' https://www.support.trainmore.com , https://www.trainmore.nl ',
      }),
    ).toEqual({
      port: 8080,
      allowedOrigins: ['https://www.support.trainmore.com', 'https://www.trainmore.nl'],
      supportContactUrl: 'https://www.support.trainmore.com/en/support/tickets/new',
    });
  });

  it('rejects an origin with a path', () => {
    expect(() => loadApiConfig({ ...api, WIDGET_ALLOWED_ORIGINS: 'https://x.com/path' })).toThrow(
      /WIDGET_ALLOWED_ORIGINS/,
    );
  });

  it('allows localhost http origins only when APP_ENV=local', () => {
    expect(() =>
      loadApiConfig({ ...api, WIDGET_ALLOWED_ORIGINS: 'http://localhost:5173' }),
    ).toThrow(/WIDGET_ALLOWED_ORIGINS/);
    expect(
      loadApiConfig({ ...api, APP_ENV: 'local', WIDGET_ALLOWED_ORIGINS: 'http://localhost:5173' })
        .allowedOrigins,
    ).toEqual(['http://localhost:5173']);
  });

  it('rejects an empty origin list', () => {
    expect(() => loadApiConfig({ ...api, WIDGET_ALLOWED_ORIGINS: ' , ' })).toThrow(
      /WIDGET_ALLOWED_ORIGINS/,
    );
  });

  it('rejects an http contact URL', () => {
    expect(() =>
      loadApiConfig({ ...api, SUPPORT_CONTACT_URL: 'http://x.example/contact' }),
    ).toThrow(/SUPPORT_CONTACT_URL/);
  });
});

describe('loadTurnstileConfig', () => {
  it('requires the secret and never echoes it', () => {
    expect(loadTurnstileConfig({ TURNSTILE_SECRET_KEY: 'ts-secret' })).toEqual({
      secretKey: 'ts-secret',
    });
    let err: ConfigError | undefined;
    try {
      loadTurnstileConfig({ TURNSTILE_SECRET_KEY: '' });
    } catch (e) {
      err = e as ConfigError;
    }
    expect(err?.message).toContain('TURNSTILE_SECRET_KEY');
  });
});
