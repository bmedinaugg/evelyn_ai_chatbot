import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient, createSupabaseConversationRepository } from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error('Supabase env missing: run via `pnpm --filter @trainmore/db test:integration`');
}

const client = createServiceClient({ url, serviceRoleKey });
const repo = createSupabaseConversationRepository(client);
const created: string[] = [];

async function newConversation(): Promise<string> {
  const { id } = await repo.create({ tokenHash: `test-hash-${created.length}`, lang: 'nl' });
  created.push(id);
  return id;
}

afterAll(async () => {
  if (created.length > 0) {
    const { error } = await client.from('conversations').delete().in('id', created);
    if (error) throw error;
  }
  const { error } = await client
    .from('lead_submissions')
    .delete()
    .eq('freshdesk_ticket_id', 990055);
  if (error) throw error;
});

describe('SupabaseConversationRepository', () => {
  it('create/get round trip', async () => {
    const id = await newConversation();
    expect(await repo.get(id)).toEqual({
      id,
      tokenHash: 'test-hash-0',
      lang: 'nl',
      userMessageCount: 0,
    });
  });

  it('get of an unknown or malformed id is null', async () => {
    expect(await repo.get('00000000-0000-4000-8000-00000000dead')).toBeNull();
    expect(await repo.get('not-a-uuid')).toBeNull();
  });

  it('claims one turn at a time and releases', async () => {
    const id = await newConversation();
    expect(await repo.claimTurn(id)).toBe(true);
    expect(await repo.claimTurn(id)).toBe(false);
    await repo.releaseTurn(id);
    expect(await repo.claimTurn(id)).toBe(true);
  });

  it('appendTurn then listApiHistory replays content unchanged', async () => {
    const id = await newConversation();
    const assistantContent = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'text', text: '{"answer":"Via de app."}' },
    ];
    await repo.claimTurn(id);
    await repo.appendTurn({
      conversationId: id,
      user: {
        displayText: 'Hoe zeg ik op?',
        apiContent: '<customer_message>Hoe zeg ik op?</customer_message>',
      },
      assistant: {
        displayText: 'Via de app.',
        apiContent: assistantContent,
        outcome: 'answered',
        citations: [{ articleId: 900101, title: 'Opzeggen', url: 'https://portal.example/nl/x' }],
      },
      flags: [],
    });
    expect(await repo.listApiHistory(id)).toEqual([
      { role: 'user', content: '<customer_message>Hoe zeg ik op?</customer_message>' },
      { role: 'assistant', content: assistantContent },
    ]);
    expect((await repo.get(id))?.userMessageCount).toBe(1);
    expect(await repo.claimTurn(id)).toBe(true);
  });

  it('appendTurn without an assistant message stores the user message only', async () => {
    const id = await newConversation();
    await repo.appendTurn({
      conversationId: id,
      user: { displayText: 'x', apiContent: 'x' },
      assistant: null,
      flags: ['error'],
    });
    expect(await repo.listApiHistory(id)).toEqual([{ role: 'user', content: 'x' }]);
  });

  it('recordLead stores no personal data', async () => {
    const id = await newConversation();
    await repo.recordLead({ conversationId: id, freshdeskTicketId: 990055, lang: 'en' });
    const { data, error } = await client
      .from('lead_submissions')
      .select('*')
      .eq('freshdesk_ticket_id', 990055);
    expect(error).toBeNull();
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual(
      ['conversation_id', 'created_at', 'freshdesk_ticket_id', 'id', 'lang'].sort(),
    );
  });
});
