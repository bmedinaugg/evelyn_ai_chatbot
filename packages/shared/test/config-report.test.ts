import { describe, expect, it } from 'vitest';
import { loadReportConfig } from '../src/config-sections.ts';

const base = {
  DAILY_REPORT_RECIPIENTS: ' support@example.com, lead@example.com ',
  PORTAL_BASE_URL: 'https://chat.example.com/',
};

describe('loadReportConfig', () => {
  it('parses recipients, defaults to Dutch and trims the portal URL', () => {
    expect(loadReportConfig(base)).toEqual({
      recipients: ['support@example.com', 'lead@example.com'],
      lang: 'nl',
      portalBaseUrl: 'https://chat.example.com',
    });
    expect(loadReportConfig({ ...base, DAILY_REPORT_LANG: 'en' }).lang).toBe('en');
  });

  it('rejects missing or invalid recipients and settings, naming the key only', () => {
    expect(() => loadReportConfig({ ...base, DAILY_REPORT_RECIPIENTS: '' })).toThrow(
      /DAILY_REPORT_RECIPIENTS/,
    );
    expect(() => loadReportConfig({ ...base, DAILY_REPORT_RECIPIENTS: 'not-an-email' })).toThrow(
      /DAILY_REPORT_RECIPIENTS/,
    );
    expect(() => loadReportConfig({ ...base, DAILY_REPORT_LANG: 'de' })).toThrow(
      /DAILY_REPORT_LANG/,
    );
    expect(() => loadReportConfig({ ...base, PORTAL_BASE_URL: 'http://chat.example.com' })).toThrow(
      /PORTAL_BASE_URL/,
    );
    try {
      loadReportConfig({ ...base, DAILY_REPORT_RECIPIENTS: 'secret-person@example' });
    } catch (error) {
      expect(String(error)).not.toContain('secret-person');
    }
  });

  it('allows at most 50 recipients (one SES message)', () => {
    const many = Array.from({ length: 51 }, (_, i) => `a${i}@example.com`).join(',');
    expect(() => loadReportConfig({ ...base, DAILY_REPORT_RECIPIENTS: many })).toThrow(
      /DAILY_REPORT_RECIPIENTS/,
    );
  });
});
