import { afterAll, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createSupabaseConversationRepository,
  createSupabaseEscalationRepository,
} from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey)
  throw new Error('Supabase env missing: run via `pnpm --filter @trainmore/db test:integration`');
const client = createServiceClient({ url, serviceRoleKey });
const escalations = createSupabaseEscalationRepository(client);
const conversations = createSupabaseConversationRepository(client);
const created: string[] = [];

afterAll(async () => {
  await client.from('escalations').delete().eq('freshdesk_ticket_id', 990077);
  await client.from('conversations').delete().in('id', created);
  await client.from('ticket_topics').delete().in('value', ['Test A', 'Test B']);
});

describe('escalation repository', () => {
  it('replaces and lists active topics', async () => {
    const before = await escalations.activeTopics();
    await escalations.replaceTopics([...before, 'Test A', 'Test B']);
    expect(await escalations.activeTopics()).toEqual(expect.arrayContaining(['Test A', 'Test B']));
    await escalations.replaceTopics(before.length > 0 ? before : ['Test A']);
  });

  it('records an escalation without personal data', async () => {
    const { id } = await conversations.create({ tokenHash: 'esc', lang: 'nl' });
    created.push(id);
    await escalations.record({
      conversationId: id,
      freshdeskTicketId: 990077,
      topic: 'Payments',
      reason: 'customer_request',
    });
    const { data } = await client.from('escalations').select('*').eq('freshdesk_ticket_id', 990077);
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual([
      'conversation_id',
      'created_at',
      'freshdesk_ticket_id',
      'id',
      'reason',
      'topic',
    ]);
  });

  it('reads the recent assistant outcomes and the transcript as the customer saw it', async () => {
    const { id } = await conversations.create({ tokenHash: 'esc2', lang: 'nl' });
    created.push(id);
    expect(await conversations.recentAssistantOutcomes(id, 2)).toEqual([]);
    const claimId = (await conversations.claimTurn(id)) as string;
    await conversations.appendTurn({
      conversationId: id,
      claimId,
      user: { displayText: 'Vraag', apiContent: '<customer_message>Vraag</customer_message>' },
      steps: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't', name: 'get_memberships', input: {} }],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'data' }] },
      ],
      assistant: { displayText: 'Antwoord', apiContent: [], outcome: 'no_match' },
      flags: [],
    });
    expect(await conversations.recentAssistantOutcomes(id, 2)).toEqual(['no_match']);
    const second = (await conversations.claimTurn(id)) as string;
    await conversations.appendTurn({
      conversationId: id,
      claimId: second,
      user: { displayText: 'Nog een', apiContent: 'q' },
      assistant: { displayText: 'Hier', apiContent: [], outcome: 'answered' },
      flags: [],
    });
    expect(await conversations.recentAssistantOutcomes(id, 2)).toEqual(['answered', 'no_match']);
    expect(await conversations.recentAssistantOutcomes(id, 1)).toEqual(['answered']);
    expect(await conversations.listTranscript(id)).toEqual([
      { role: 'user', text: 'Vraag' },
      { role: 'assistant', text: 'Antwoord' },
      { role: 'user', text: 'Nog een' },
      { role: 'assistant', text: 'Hier' },
    ]);
  });
});
