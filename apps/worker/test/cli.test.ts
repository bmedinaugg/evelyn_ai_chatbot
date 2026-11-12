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

  it('rejects unknown commands and flags', () => {
    expect(parseArgs(['drop-everything'])).toBeUndefined();
    expect(parseArgs(['sync-faq', '--force'])).toBeUndefined();
    expect(parseArgs([])).toBeUndefined();
  });
});
