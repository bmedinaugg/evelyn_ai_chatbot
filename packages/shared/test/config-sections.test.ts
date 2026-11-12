import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.ts';
import {
  loadFreshdeskConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
} from '../src/config-sections.ts';

const fd = {
  FRESHDESK_DOMAIN: 'trainmore.freshdesk.com',
  FRESHDESK_API_KEY: 'fd-key',
  FRESHDESK_FAQ_FOLDER_IDS: '101',
  FRESHDESK_PORTAL_URL: 'https://portal.test',
};

describe('loadFreshdeskConfig', () => {
  it('parses a valid env', () => {
    expect(loadFreshdeskConfig(fd)).toEqual({
      domain: 'trainmore.freshdesk.com',
      apiKey: 'fd-key',
      faqFolderIds: [101],
      portalUrl: 'https://portal.test',
      topicField: 'ticket_type',
    });
  });

  it('reads the ticket topic field name', () => {
    expect(loadFreshdeskConfig({ ...fd, FRESHDESK_TOPIC_FIELD: 'cf_topic' }).topicField).toBe(
      'cf_topic',
    );
  });

  it('parses folder ids with spaces', () => {
    expect(
      loadFreshdeskConfig({ ...fd, FRESHDESK_FAQ_FOLDER_IDS: ' 101, 202 ' }).faqFolderIds,
    ).toEqual([101, 202]);
  });

  it('rejects non-numeric or empty folder ids', () => {
    expect(() => loadFreshdeskConfig({ ...fd, FRESHDESK_FAQ_FOLDER_IDS: '101,abc' })).toThrow(
      /FRESHDESK_FAQ_FOLDER_IDS/,
    );
    expect(() => loadFreshdeskConfig({ ...fd, FRESHDESK_FAQ_FOLDER_IDS: '' })).toThrow(
      /FRESHDESK_FAQ_FOLDER_IDS/,
    );
  });

  it('rejects a domain with scheme or path', () => {
    expect(() =>
      loadFreshdeskConfig({ ...fd, FRESHDESK_DOMAIN: 'https://x.freshdesk.com/' }),
    ).toThrow(/FRESHDESK_DOMAIN/);
  });

  it('strips a trailing slash from the portal URL', () => {
    expect(
      loadFreshdeskConfig({ ...fd, FRESHDESK_PORTAL_URL: 'https://portal.test/' }).portalUrl,
    ).toBe('https://portal.test');
  });

  it('never echoes the API key', () => {
    let err: ConfigError | undefined;
    try {
      loadFreshdeskConfig({ ...fd, FRESHDESK_DOMAIN: 'fd-secret-xyz/bad', FRESHDESK_API_KEY: '' });
    } catch (e) {
      err = e as ConfigError;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err?.message).toContain('FRESHDESK_API_KEY');
    expect(err?.message).not.toContain('fd-secret-xyz');
  });
});

describe('loadSupabaseConfig', () => {
  it('parses a valid env', () => {
    expect(
      loadSupabaseConfig({
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
      }),
    ).toEqual({ url: 'http://127.0.0.1:54321', serviceRoleKey: 'k' });
  });

  it('never echoes secrets', () => {
    let err: ConfigError | undefined;
    try {
      loadSupabaseConfig({
        SUPABASE_URL: 'not a url sb-secret-xyz',
        SUPABASE_SERVICE_ROLE_KEY: '',
      });
    } catch (e) {
      err = e as ConfigError;
    }
    expect(err?.message).toContain('SUPABASE_URL');
    expect(err?.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(err?.message).not.toContain('sb-secret-xyz');
  });
});

describe('loadRuntimeConfig', () => {
  it('ignores Magicline keys', () => {
    expect(
      loadRuntimeConfig({ NODE_ENV: 'test', APP_ENV: 'local', AWS_REGION: 'eu-west-1' }),
    ).toEqual({
      nodeEnv: 'test',
      appEnv: 'local',
      awsRegion: 'eu-west-1',
      logLevel: 'info',
    });
  });
});
