import { Writable } from 'node:stream';
import type { AuthRepository, AuthState } from '@trainmore/db';
import { createLogger } from '@trainmore/shared';
import { describe, expect, it } from 'vitest';
import { logIn } from '../src/run-evals.ts';

const logger = createLogger({
  name: 'test',
  level: 'fatal',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});

/** Same per-email window rule as create_otp_challenge (3 codes per email hash). */
function fakeAuth() {
  const challenges: { id: string; conversationId: string; emailHash: string; codeHash: string }[] =
    [];
  const state = new Map<string, AuthState>();
  const repo: AuthRepository = {
    async createOtpChallenge(input) {
      if (challenges.filter((c) => c.emailHash === input.emailHash).length >= input.maxPerWindow)
        return false;
      challenges.push(input);
      return true;
    },
    async latestOpenChallengeId(conversationId, emailHash) {
      return (
        challenges
          .filter((c) => c.conversationId === conversationId && c.emailHash === emailHash)
          .at(-1)?.id ?? null
      );
    },
    async verifyOtpAttempt({ challengeId, conversationId, codeHash }) {
      const c = challenges.find((x) => x.id === challengeId);
      if (!c || c.codeHash !== codeHash) return 'invalid';
      state.set(conversationId, {
        verified: true,
        verifiedEmailHash: c.emailHash,
        candidates: null,
        account: null,
      });
      return 'ok';
    },
    async setAccountCandidates() {},
    async bindAccount() {
      return true;
    },
    async getAuthState(id) {
      return (
        state.get(id) ?? {
          verified: false,
          verifiedEmailHash: null,
          candidates: null,
          account: null,
        }
      );
    },
  };
  return repo;
}

describe('eval logIn', () => {
  it('logs the same synthetic profile in more often than the per-email code limit', async () => {
    const login = {
      auth: fakeAuth(),
      magicline: { searchByEmail: async () => [], studioName: async () => 'Club' },
      config: {
        secret: 's'.repeat(32),
        ttlSeconds: 300,
        maxAttempts: 5,
        maxPerWindow: 3,
        windowSeconds: 900,
      },
      logger,
    };
    for (let i = 0; i < 5; i += 1) {
      await expect(logIn(login, `conv-${i}`, 'member.single@example.com')).resolves.toBeUndefined();
    }
  });
});
