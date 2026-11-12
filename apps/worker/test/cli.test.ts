import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli.ts';

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
    expect(parseArgs(['dsar-delete'])).toBeUndefined();
    expect(parseArgs(['dsar-delete', '--email'])).toBeUndefined();
    expect(parseArgs(['sync-faq', '--email', 'a@example.com'])).toBeUndefined();
  });

  it('rejects unknown commands and flags', () => {
    expect(parseArgs(['drop-everything'])).toBeUndefined();
    expect(parseArgs(['sync-faq', '--force'])).toBeUndefined();
    expect(parseArgs([])).toBeUndefined();
  });
});
