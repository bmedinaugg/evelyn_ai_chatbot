import { afterAll, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createSupabaseConversationRepository,
  createSupabaseRetentionRepository,
} from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey)
  throw new Error('Supabase env missing: run via `pnpm --filter @trainmore/db test:integration`');
const client = createServiceClient({ url, serviceRoleKey });
const retention = createSupabaseRetentionRepository(client);
const conversations = createSupabaseConversationRepository(client);
const created: string[] = [];
// Dates far in the past, so the test never touches other local conversations.
const LONG_AGO = '2000-01-01T00:00:00Z';
const CUTOFF = new Date('2000-06-01T00:00:00Z');
const HASH = 'f'.repeat(64);

afterAll(async () => {
  await client.from('conversations').delete().in('id', created);
});

async function oldConversation(hash: string): Promise<string> {
  const { id } = await conversations.create({ tokenHash: 'retention-test', lang: 'nl' });
  created.push(id);
  const claim = await conversations.claimTurn(id);
  if (!claim) throw new Error('no claim');
  await conversations.appendTurn({
    conversationId: id,
    claimId: claim,
    user: { displayText: 'Mijn naam is Sam', apiContent: 'q' },
    assistant: { displayText: 'Hoi Sam', apiContent: [], outcome: 'answered', citations: [] },
    flags: [],
  });
  await client
    .from('conversations')
    .update({
      last_message_at: LONG_AGO,
      created_at: LONG_AGO,
      verified_email_hash: hash,
      verified_at: LONG_AGO,
      customer_id: 1,
    })
    .eq('id', id);
  return id;
}

describe('retention repository', () => {
  it('anonymises conversations without activity since the cutoff', async () => {
    const id = await oldConversation('d'.repeat(64));
    expect(await retention.anonymiseConversations(CUTOFF, 100)).toBeGreaterThanOrEqual(1);
    const { data } = await client.from('messages').select('display_text').eq('conversation_id', id);
    expect(data?.every((m) => m.display_text === '')).toBe(true);
    expect(await retention.anonymiseConversations(CUTOFF, 100)).toBe(0);
  });

  it('clears account bindings and purges old login codes', async () => {
    const id = await oldConversation('e'.repeat(64));
    expect(await retention.clearAccountBindings(CUTOFF)).toBeGreaterThanOrEqual(1);
    const { data } = await client.from('conversations').select('customer_id').eq('id', id).single();
    expect(data?.customer_id).toBeNull();
    expect(await retention.purgeOtpChallenges(CUTOFF)).toBeGreaterThanOrEqual(0);
  });

  it('deletes everything verified with an email hash', async () => {
    const id = await oldConversation(HASH);
    expect(await retention.dsarDelete(HASH)).toEqual({ conversations: 1, otpChallenges: 0 });
    expect((await client.from('conversations').select('id').eq('id', id)).data).toEqual([]);
  });
});
