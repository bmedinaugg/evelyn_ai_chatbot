import { afterAll, describe, expect, it } from 'vitest';
import {
  ClaimLostError,
  createServiceClient,
  createSupabaseConversationRepository,
} from '../src/index.ts';

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

  it('claims one turn at a time and releases only with the claim id', async () => {
    const id = await newConversation();
    const claim = await repo.claimTurn(id);
    expect(claim).toMatch(/^[0-9a-f-]{36}$/);
    expect(await repo.claimTurn(id)).toBeNull();
    await repo.releaseTurn(id, '00000000-0000-4000-8000-000000000000');
    expect(await repo.claimTurn(id)).toBeNull();
    await repo.releaseTurn(id, claim as string);
    expect(await repo.claimTurn(id)).not.toBeNull();
  });

  it('appendTurn with a lost claim throws ClaimLostError and stores nothing', async () => {
    const id = await newConversation();
    await repo.claimTurn(id);
    await expect(
      repo.appendTurn({
        conversationId: id,
        claimId: '00000000-0000-4000-8000-000000000000',
        user: { displayText: 'x', apiContent: 'x' },
        assistant: null,
        flags: [],
      }),
    ).rejects.toBeInstanceOf(ClaimLostError);
    expect(await repo.listApiHistory(id)).toEqual([]);
  });

  it('appendTurn then listApiHistory replays content unchanged', async () => {
    const id = await newConversation();
    const assistantContent = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'text', text: '{"answer":"Via de app."}' },
    ];
    const claimId = (await repo.claimTurn(id)) as string;
    await repo.appendTurn({
      conversationId: id,
      claimId,
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
    expect(await repo.claimTurn(id)).not.toBeNull();
  });

  it('appendTurn with tool steps replays them in order between question and answer', async () => {
    const id = await newConversation();
    const claimId = (await repo.claimTurn(id)) as string;
    const steps = [
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 't1', name: 'get_memberships', input: {} }],
      },
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]' }],
      },
    ];
    await repo.appendTurn({
      conversationId: id,
      claimId,
      user: { displayText: 'q', apiContent: 'q' },
      steps,
      assistant: {
        displayText: 'a',
        apiContent: [{ type: 'text', text: '{}' }],
        outcome: 'answered',
      },
      flags: [],
    });
    expect(await repo.listApiHistory(id)).toEqual([
      { role: 'user', content: 'q' },
      ...steps,
      { role: 'assistant', content: [{ type: 'text', text: '{}' }] },
    ]);
  });

  it('appendTurn without an assistant message stores the user message only', async () => {
    const id = await newConversation();
    const claimId = (await repo.claimTurn(id)) as string;
    await repo.appendTurn({
      conversationId: id,
      claimId,
      user: { displayText: 'x', apiContent: 'x' },
      assistant: null,
      flags: ['error'],
    });
    expect(await repo.listApiHistory(id)).toEqual([{ role: 'user', content: 'x' }]);
  });

  it('appendTurn returns the reply id, which only this conversation can rate', async () => {
    const id = await newConversation();
    const claim = await repo.claimTurn(id);
    if (!claim) throw new Error('no claim');
    const messageId = await repo.appendTurn({
      conversationId: id,
      claimId: claim,
      user: { displayText: 'Vraag', apiContent: 'q' },
      assistant: { displayText: 'Antwoord', apiContent: [], outcome: 'answered', citations: [] },
      flags: [],
    });
    expect(typeof messageId).toBe('number');
    if (messageId === null) throw new Error('no message id');
    expect(await repo.recordFeedback(id, messageId, 'down')).toBe(true);
    const other = await newConversation();
    expect(await repo.recordFeedback(other, messageId, 'up')).toBe(false);
    const { data } = await client.from('flags').select('reason').eq('conversation_id', id);
    expect(data?.map((f) => f.reason)).toEqual(['thumbs_down']);
  });

  it('appendTurn without a reply returns null', async () => {
    const id = await newConversation();
    const claim = await repo.claimTurn(id);
    if (!claim) throw new Error('no claim');
    expect(
      await repo.appendTurn({
        conversationId: id,
        claimId: claim,
        user: { displayText: 'Vraag', apiContent: 'q' },
        assistant: null,
        flags: ['refusal'],
      }),
    ).toBeNull();
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
