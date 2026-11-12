import { Writable } from 'node:stream';
import type { RetentionRepository } from '@trainmore/db';
import { createLogger } from '@trainmore/shared';
import { describe, expect, it } from 'vitest';
import { runDsarDelete, runRetention } from '../src/retention.ts';

let logOutput = '';
const logger = createLogger({
  name: 'test',
  level: 'info',
  destination: new Writable({
    write(chunk, _e, cb) {
      logOutput += chunk.toString();
      cb();
    },
  }),
});

function fakeRepo(pendingConversations: number) {
  let pending = pendingConversations;
  const calls: { fn: string; before?: string; limit?: number; hash?: string }[] = [];
  const repo: RetentionRepository = {
    async anonymiseConversations(before, limit) {
      calls.push({ fn: 'anonymise', before: before.toISOString(), limit });
      const n = Math.min(pending, limit);
      pending -= n;
      return n;
    },
    async purgeOtpChallenges(before) {
      calls.push({ fn: 'purge', before: before.toISOString() });
      return 3;
    },
    async clearAccountBindings(before) {
      calls.push({ fn: 'bindings', before: before.toISOString() });
      return 2;
    },
    async dsarDelete(hash) {
      calls.push({ fn: 'dsar', hash });
      return { conversations: 4, otpChallenges: 1 };
    },
  };
  return { repo, calls };
}

const NOW = new Date('2026-11-12T03:00:00Z');

describe('runRetention', () => {
  it('anonymises in batches until done and uses 90 days / 24 hours cutoffs', async () => {
    const { repo, calls } = fakeRepo(1200);
    const result = await runRetention({ repo, now: () => NOW, logger, batchSize: 500 });
    expect(result).toEqual({ anonymised: 1200, otpChallengesPurged: 3, bindingsCleared: 2 });
    expect(calls.filter((c) => c.fn === 'anonymise').map((c) => c.limit)).toEqual([500, 500, 500]);
    expect(calls.find((c) => c.fn === 'anonymise')?.before).toBe('2026-08-14T03:00:00.000Z');
    expect(calls.find((c) => c.fn === 'purge')?.before).toBe('2026-11-11T03:00:00.000Z');
    expect(calls.find((c) => c.fn === 'bindings')?.before).toBe('2026-11-11T03:00:00.000Z');
  });

  it('stops after a bounded number of batches', async () => {
    const { repo, calls } = fakeRepo(1_000_000);
    await runRetention({ repo, now: () => NOW, logger, batchSize: 10, maxBatches: 5 });
    expect(calls.filter((c) => c.fn === 'anonymise')).toHaveLength(5);
  });
});

describe('runDsarDelete', () => {
  it('deletes by the email hash and logs counts only', async () => {
    logOutput = '';
    const { repo, calls } = fakeRepo(0);
    const result = await runDsarDelete({
      repo,
      email: ' Sam@Example.com ',
      secret: 's'.repeat(32),
      logger,
    });
    expect(result).toEqual({ conversations: 4, otpChallenges: 1 });
    expect(calls[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(logOutput).not.toMatch(/sam@example\.com/i);
    expect(logOutput).not.toContain(calls[0]?.hash ?? 'x');
  });

  it('uses the same hash as the login (so it finds the verified conversations)', async () => {
    const { hashEmail } = await import('@trainmore/core');
    const { repo, calls } = fakeRepo(0);
    await runDsarDelete({ repo, email: 'sam@example.com', secret: 's'.repeat(32), logger });
    expect(calls[0]?.hash).toBe(hashEmail('s'.repeat(32), 'sam@example.com'));
  });

  it('rejects something that is not an email', async () => {
    const { repo, calls } = fakeRepo(0);
    await expect(
      runDsarDelete({ repo, email: 'not-an-email', secret: 's'.repeat(32), logger }),
    ).rejects.toThrow(/email/);
    expect(calls).toEqual([]);
  });
});

describe('readEmailFromStdin', () => {
  it('reads the first line', async () => {
    const { Readable } = await import('node:stream');
    const { readEmailFromStdin } = await import('../src/retention.ts');
    expect(await readEmailFromStdin(Readable.from(['sam@example.com\nrest']))).toBe(
      'sam@example.com',
    );
  });
});
