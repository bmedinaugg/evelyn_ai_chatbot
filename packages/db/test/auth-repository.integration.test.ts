import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createSupabaseAuthRepository,
  createSupabaseConversationRepository,
} from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey)
  throw new Error('Supabase env missing: run via `pnpm --filter @trainmore/db test:integration`');

const client = createServiceClient({ url, serviceRoleKey });
const auth = createSupabaseAuthRepository(client);
const conversations = createSupabaseConversationRepository(client);
const created: string[] = [];
const emailHash = `test-email-${randomUUID()}`;

async function newConversation(): Promise<string> {
  const { id } = await conversations.create({ tokenHash: 'auth-test', lang: 'nl' });
  created.push(id);
  return id;
}

afterAll(async () => {
  await client.from('conversations').delete().in('id', created);
});

const challenge = (conversationId: string, id = randomUUID()) => ({
  id,
  conversationId,
  emailHash,
  codeHash: `code-${id}`,
  ttlSeconds: 300,
  maxPerWindow: 3,
  windowSeconds: 900,
});

describe('SupabaseAuthRepository', () => {
  it('creates a challenge, finds it, and verifies the conversation', async () => {
    const conversationId = await newConversation();
    const input = challenge(conversationId);
    expect(await auth.createOtpChallenge(input)).toBe(true);
    expect(await auth.latestOpenChallengeId(conversationId, emailHash)).toBe(input.id);
    expect(
      await auth.verifyOtpAttempt({
        challengeId: input.id,
        conversationId,
        codeHash: 'nope',
        maxAttempts: 5,
      }),
    ).toBe('invalid');
    expect(
      await auth.verifyOtpAttempt({
        challengeId: input.id,
        conversationId,
        codeHash: input.codeHash,
        maxAttempts: 5,
      }),
    ).toBe('ok');
    expect(await auth.latestOpenChallengeId(conversationId, emailHash)).toBeNull();
    expect((await auth.getAuthState(conversationId)).verified).toBe(true);
  });

  it('refuses a fourth challenge for the same email in the window', async () => {
    const conversationId = await newConversation();
    expect(await auth.createOtpChallenge(challenge(conversationId))).toBe(true);
    expect(await auth.createOtpChallenge(challenge(conversationId))).toBe(true);
    expect(await auth.createOtpChallenge(challenge(conversationId))).toBe(false);
  });

  it('stores candidates and binds only a valid index once', async () => {
    const conversationId = await newConversation();
    const email = `test-email-${randomUUID()}`;
    const input = { ...challenge(conversationId), emailHash: email };
    await auth.createOtpChallenge(input);
    await auth.verifyOtpAttempt({
      challengeId: input.id,
      conversationId,
      codeHash: input.codeHash,
      maxAttempts: 5,
    });
    await auth.setAccountCandidates(conversationId, [
      {
        customerId: 4,
        studioId: 1001,
        status: 'MEMBER',
        studioName: 'Club A',
        maskedNumber: '•••004',
      },
      {
        customerId: 5,
        studioId: 1002,
        status: 'FORMER_MEMBER',
        studioName: 'Club B',
        maskedNumber: '•••005',
      },
    ]);
    expect(await auth.bindAccount(conversationId, 7)).toBe(false);
    expect(await auth.bindAccount(conversationId, 1)).toBe(true);
    expect(await auth.bindAccount(conversationId, 0)).toBe(false);
    expect(await auth.getAuthState(conversationId)).toMatchObject({
      verified: true,
      account: { customerId: 5, studioId: 1002, status: 'FORMER_MEMBER' },
    });
  });

  it('an unverified conversation has no state', async () => {
    const conversationId = await newConversation();
    expect(await auth.getAuthState(conversationId)).toEqual({
      verified: false,
      candidates: null,
      account: null,
    });
  });
});
