import { describe, expect, it } from 'vitest';
import { parseArgs, runCommand } from '../src/cli.ts';

describe('parseArgs', () => {
  it('parses a command', () => {
    expect(parseArgs(['sync-faq'])).toEqual({ command: 'sync-faq', allowMassChange: false });
  });

  it('parses --allow-mass-change', () => {
    expect(parseArgs(['sync-faq', '--allow-mass-change'])).toEqual({
      command: 'sync-faq',
      allowMassChange: true,
    });
  });

  it('parses sync-ticket-topics', () => {
    expect(parseArgs(['sync-ticket-topics'])).toEqual({
      command: 'sync-ticket-topics',
      allowMassChange: false,
    });
  });

  it('parses retention and dsar-delete --email', () => {
    expect(parseArgs(['retention'])).toEqual({ command: 'retention', allowMassChange: false });
    expect(parseArgs(['dsar-delete', '--email', 'a@example.com'])).toEqual({
      command: 'dsar-delete',
      allowMassChange: false,
      email: 'a@example.com',
    });
    // Without --email the address is read from the terminal (never on the command line in AWS).
    expect(parseArgs(['dsar-delete'])).toEqual({ command: 'dsar-delete', allowMassChange: false });
    expect(parseArgs(['dsar-delete', '--email'])).toBeUndefined();
    expect(parseArgs(['sync-faq', '--email', 'a@example.com'])).toBeUndefined();
  });

  it('parses daily-report with --day and --resend', () => {
    expect(parseArgs(['daily-report'])).toEqual({
      command: 'daily-report',
      allowMassChange: false,
      resend: false,
    });
    expect(parseArgs(['daily-report', '--day', '2026-10-25', '--resend'])).toEqual({
      command: 'daily-report',
      allowMassChange: false,
      day: '2026-10-25',
      resend: true,
    });
    expect(parseArgs(['daily-report', '--day'])).toBeUndefined();
    expect(parseArgs(['daily-report', '--day', '2026-02-30'])).toBeUndefined();
    expect(parseArgs(['daily-report', '--allow-mass-change'])).toBeUndefined();
    expect(parseArgs(['retention', '--resend'])).toBeUndefined();
  });

  it('accepts --day only locally (servers report on yesterday)', async () => {
    await expect(
      runCommand(
        'daily-report',
        { NODE_ENV: 'production', APP_ENV: 'preprod', AWS_REGION: 'eu-west-1' },
        { allowMassChange: false, day: '2026-10-25', resend: false },
      ),
    ).rejects.toThrow(/--day only works with APP_ENV=local/);
  });

  it('rejects unknown commands and flags', () => {
    expect(parseArgs(['drop-everything'])).toBeUndefined();
    expect(parseArgs(['sync-faq', '--force'])).toBeUndefined();
    expect(parseArgs([])).toBeUndefined();
  });

  it('accepts --email only locally (it would end up in AWS records and shell history)', async () => {
    await expect(
      runCommand(
        'dsar-delete',
        { NODE_ENV: 'production', APP_ENV: 'preprod', AWS_REGION: 'eu-west-1' },
        { allowMassChange: false, email: 'a@example.com' },
      ),
    ).rejects.toThrow(/--email only works with APP_ENV=local/);
  });
});
