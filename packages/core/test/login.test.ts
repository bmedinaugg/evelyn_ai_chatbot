import { Writable } from 'node:stream';
import type { AccountCandidate, AuthRepository, AuthState, VerifyResult } from '@trainmore/db';
import type { LoginCodeMessage } from '@trainmore/email';
import type { CustomerLookup } from '@trainmore/magicline';
import { createLogger } from '@trainmore/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  generateCode,
  hashCode,
  hashEmail,
  type LoginDeps,
  lookupAccounts,
  requestLoginCode,
  selectAccount,
  verifyLoginCode,
} from '../src/auth/login.ts';

const SECRET = 's'.repeat(32);
const CONV = '00000000-0000-4000-8000-000000000001';

type Challenge = {
  id: string;
  conversationId: string;
  emailHash: string;
  codeHash: string;
  attempts: number;
  consumed: boolean;
};

function fakeAuth() {
  const challenges: Challenge[] = [];
  const state: {
    verifiedHash: string | null;
    candidates: AccountCandidate[] | null;
    bound: number | null;
  } = {
    verifiedHash: null,
    candidates: null,
    bound: null,
  };
  let allow = true;
  const repo: AuthRepository = {
    async createOtpChallenge(input) {
      if (!allow) return false;
      challenges.push({ ...input, attempts: 0, consumed: false });
      return true;
    },
    async latestOpenChallengeId(conversationId, emailHash) {
      return (
        challenges
          .filter(
            (c) => c.conversationId === conversationId && c.emailHash === emailHash && !c.consumed,
          )
          .at(-1)?.id ?? null
      );
    },
    async verifyOtpAttempt({ challengeId, codeHash, maxAttempts }): Promise<VerifyResult> {
      const c = challenges.find((x) => x.id === challengeId);
      if (!c || c.consumed) return 'not_found';
      if (c.attempts >= maxAttempts) return 'locked';
      if (c.codeHash === codeHash) {
        c.consumed = true;
        state.verifiedHash = c.emailHash;
        return 'ok';
      }
      c.attempts += 1;
      return c.attempts >= maxAttempts ? 'locked' : 'invalid';
    },
    async setAccountCandidates(_id, candidates) {
      state.candidates = candidates;
    },
    async bindAccount(_id, index) {
      if (!state.verifiedHash || !state.candidates?.[index] || state.bound !== null) return false;
      state.bound = index;
      return true;
    },
    async getAuthState(): Promise<AuthState> {
      const c = state.bound === null ? null : state.candidates?.[state.bound];
      return {
        verified: state.verifiedHash !== null,
        verifiedEmailHash: state.verifiedHash,
        candidates: state.candidates,
        account: c ? { customerId: c.customerId, studioId: c.studioId, status: c.status } : null,
      };
    },
  };
  return { repo, challenges, state, block: () => (allow = false) };
}

let sent: LoginCodeMessage[];
let lookups: CustomerLookup[] | Error;
let logOutput: string;
let auth: ReturnType<typeof fakeAuth>;

function deps(): LoginDeps {
  const email: LoginDeps['email'] = {
    async sendLoginCode(message) {
      sent.push(message);
    },
  };
  return {
    auth: auth.repo,
    email,
    magicline: {
      async searchByEmail() {
        if (lookups instanceof Error) throw lookups;
        return lookups;
      },
      async studioName(studioId) {
        return studioId === 1001 ? 'Club A' : 'Club B';
      },
    },
    config: {
      secret: SECRET,
      ttlSeconds: 300,
      maxAttempts: 5,
      maxPerWindow: 3,
      windowSeconds: 900,
    },
    logger: createLogger({
      name: 'test',
      level: 'info',
      destination: new Writable({
        write(chunk, _e, cb) {
          logOutput += chunk.toString();
          cb();
        },
      }),
    }),
  };
}

async function loginCode(): Promise<string> {
  await requestLoginCode(deps(), { conversationId: CONV, email: ' Lead@Example.com ', lang: 'nl' });
  return sent.at(-1)?.code ?? '';
}

beforeEach(() => {
  sent = [];
  logOutput = '';
  lookups = [{ customerId: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' }];
  auth = fakeAuth();
});

describe('hashing and codes', () => {
  it('normalises email before hashing and never returns the plaintext', () => {
    expect(hashEmail(SECRET, ' Lead@Example.com ')).toBe(hashEmail(SECRET, 'lead@example.com'));
    expect(hashEmail(SECRET, 'lead@example.com')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode(SECRET, 'c1', '123456')).not.toBe(hashCode(SECRET, 'c2', '123456'));
  });

  it('generates 6-digit codes', () => {
    for (let i = 0; i < 50; i += 1) expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe('requestLoginCode', () => {
  it('stores only hashes and emails the code to the normalised address', async () => {
    const code = await loginCode();
    expect(sent[0]).toMatchObject({ to: 'lead@example.com', lang: 'nl', validMinutes: 5 });
    expect(auth.challenges[0]?.emailHash).toBe(hashEmail(SECRET, 'lead@example.com'));
    expect(JSON.stringify(auth.challenges)).not.toMatch(/lead@example\.com|Lead@Example/);
    expect(JSON.stringify(auth.challenges)).not.toContain(code);
  });

  it('sends nothing when the email is rate-limited, without telling the caller', async () => {
    auth.block();
    await expect(
      requestLoginCode(deps(), { conversationId: CONV, email: 'lead@example.com', lang: 'nl' }),
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it('rejects an invalid email address before doing anything', async () => {
    await expect(
      requestLoginCode(deps(), { conversationId: CONV, email: 'not-an-email', lang: 'nl' }),
    ).rejects.toThrow();
    expect(auth.challenges).toHaveLength(0);
  });
});

describe('verifyLoginCode', () => {
  it('verifies, finds one account and binds it automatically', async () => {
    const code = await loginCode();
    const outcome = await verifyLoginCode(deps(), {
      conversationId: CONV,
      email: 'lead@example.com',
      code,
    });
    expect(outcome).toEqual({
      kind: 'verified',
      accounts: [{ index: 0, studioName: 'Club A', status: 'MEMBER', maskedNumber: '•••004' }],
      selected: 0,
    });
    expect((await auth.repo.getAuthState(CONV)).account).toEqual({
      customerId: 4,
      studioId: 1001,
      status: 'MEMBER',
    });
  });

  it('lets the visitor choose when there are several accounts', async () => {
    lookups = [
      { customerId: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' },
      { customerId: 5, studioId: 1002, status: 'FORMER_MEMBER', customerNumber: null },
    ];
    const code = await loginCode();
    const outcome = await verifyLoginCode(deps(), {
      conversationId: CONV,
      email: 'lead@example.com',
      code,
    });
    expect(outcome).toMatchObject({ kind: 'verified', selected: null });
    expect(outcome.kind === 'verified' && outcome.accounts[1]).toEqual({
      index: 1,
      studioName: 'Club B',
      status: 'FORMER_MEMBER',
      maskedNumber: '•••005',
    });
    expect(await selectAccount(deps(), { conversationId: CONV, index: 5 })).toBeNull();
    expect(await selectAccount(deps(), { conversationId: CONV, index: 1 })).toMatchObject({
      index: 1,
      studioName: 'Club B',
    });
  });

  it('a verified email without accounts is verified with no accounts', async () => {
    lookups = [];
    const code = await loginCode();
    expect(
      await verifyLoginCode(deps(), { conversationId: CONV, email: 'lead@example.com', code }),
    ).toEqual({
      kind: 'verified',
      accounts: [],
      selected: null,
    });
  });

  it('a wrong code, a malformed code or another email fails', async () => {
    await loginCode();
    expect(
      await verifyLoginCode(deps(), {
        conversationId: CONV,
        email: 'lead@example.com',
        code: '000000',
      }),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      await verifyLoginCode(deps(), {
        conversationId: CONV,
        email: 'lead@example.com',
        code: '12ab',
      }),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      await verifyLoginCode(deps(), {
        conversationId: CONV,
        email: 'other@example.com',
        code: '123456',
      }),
    ).toMatchObject({ kind: 'expired' });
  });

  it('when Magicline is down, the visitor is verified and can retry the lookup', async () => {
    lookups = new Error('Magicline 503');
    const code = await loginCode();
    expect(
      await verifyLoginCode(deps(), { conversationId: CONV, email: 'lead@example.com', code }),
    ).toEqual({ kind: 'lookup_failed' });
    lookups = [{ customerId: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' }];
    expect(
      await lookupAccounts(deps(), { conversationId: CONV, email: 'lead@example.com' }),
    ).toMatchObject({ kind: 'verified', selected: 0 });
    expect(
      await lookupAccounts(deps(), { conversationId: CONV, email: 'someone@example.com' }),
    ).toEqual({ kind: 'expired' });
  });

  it('a studio without a configured key does not block the login', async () => {
    lookups = [
      { customerId: 9, studioId: 4040, status: 'FORMER_MEMBER', customerNumber: 'M-0009' },
    ];
    const code = await loginCode();
    const failingNames: LoginDeps = {
      ...deps(),
      magicline: {
        searchByEmail: async () => lookups as never,
        studioName: async () => {
          throw new Error('No Magicline API key configured for studio 4040');
        },
      },
    };
    expect(
      await verifyLoginCode(failingNames, {
        conversationId: CONV,
        email: 'lead@example.com',
        code,
      }),
    ).toEqual({
      kind: 'verified',
      accounts: [
        { index: 0, studioName: 'TrainMore', status: 'FORMER_MEMBER', maskedNumber: '•••009' },
      ],
      selected: 0,
    });
  });

  it('never logs the email address or the code', async () => {
    const code = await loginCode();
    await verifyLoginCode(deps(), { conversationId: CONV, email: 'lead@example.com', code });
    expect(logOutput).not.toMatch(/lead@example\.com/i);
    expect(logOutput).not.toContain(code);
  });
});
