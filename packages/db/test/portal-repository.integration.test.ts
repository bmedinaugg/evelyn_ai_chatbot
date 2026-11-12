import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createSupabaseConversationRepository,
  createSupabasePortalRepository,
} from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey)
  throw new Error('Supabase env missing: run via `pnpm --filter @trainmore/db test:integration`');
const client = createServiceClient({ url, serviceRoleKey });
const portal = createSupabasePortalRepository(client);
const conversations = createSupabaseConversationRepository(client);
const created: string[] = [];
const sessions: string[] = [];

afterAll(async () => {
  await client.from('conversations').delete().in('id', created);
  await client.from('portal_sessions').delete().in('id_hash', sessions);
  await client.from('capability_flags').delete().eq('name', 'test_capability');
});

describe('portal repository', () => {
  it('creates, reads and deletes a session (expired ones are not returned)', async () => {
    const idHash = randomUUID();
    sessions.push(idHash);
    await portal.createSession({
      idHash,
      userOid: 'oid-1',
      displayName: 'Agent One',
      roles: ['agent'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await portal.getSession(idHash)).toEqual({
      userOid: 'oid-1',
      displayName: 'Agent One',
      roles: ['agent'],
    });
    await portal.deleteSession(idHash);
    expect(await portal.getSession(idHash)).toBeNull();

    const expired = randomUUID();
    sessions.push(expired);
    await portal.createSession({
      idHash: expired,
      userOid: 'oid-1',
      displayName: 'Agent One',
      roles: ['agent'],
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await portal.getSession(expired)).toBeNull();
  });

  it('lists a flagged conversation and returns its detail with feedback', async () => {
    const { id } = await conversations.create({ tokenHash: 'portal-test', lang: 'nl' });
    created.push(id);
    const claim = (await conversations.claimTurn(id)) as string;
    const replyId = await conversations.appendTurn({
      conversationId: id,
      claimId: claim,
      user: { displayText: 'Mail me op sam@example.com', apiContent: 'q' },
      steps: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'data' }] },
      ],
      assistant: {
        displayText: 'Geen antwoord',
        apiContent: [],
        outcome: 'no_match',
        citations: [],
      },
      flags: ['no_match'],
    });
    if (replyId === null) throw new Error('no reply id');
    await conversations.recordFeedback(id, replyId, 'down');

    const list = await portal.listFlagged({
      since: new Date(Date.now() - 60_000),
      limit: 50,
      offset: 0,
    });
    expect(list.find((row) => row.conversationId === id)).toMatchObject({
      lang: 'nl',
      reasons: ['no_match', 'thumbs_down'],
      escalated: false,
      loggedIn: false,
    });
    const ended = await portal.listFlagged({
      since: new Date(Date.now() - 60_000),
      until: new Date(Date.now() - 30_000),
      limit: 50,
      offset: 0,
    });
    expect(ended.find((row) => row.conversationId === id)).toBeUndefined();

    await client.from('conversations').update({ customer_status: 'MEMBER' }).eq('id', id);
    const detail = await portal.conversationDetail(id);
    expect(detail?.customerStatus).toBe('MEMBER');
    expect(detail?.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'Mail me op sam@example.com', rating: null }),
      expect.objectContaining({
        role: 'assistant',
        text: 'Geen antwoord',
        outcome: 'no_match',
        rating: 'down',
      }),
    ]);
    expect(detail?.flags.map((f) => f.reason).sort()).toEqual(['no_match', 'thumbs_down']);
    expect(await portal.conversationDetail(randomUUID())).toBeNull();
  });

  it('switches a capability with an audit row', async () => {
    await portal.setCapability('test_capability', false, { oid: 'oid-admin', name: 'Admin' });
    expect(
      (await portal.listCapabilityFlags()).find((f) => f.name === 'test_capability'),
    ).toMatchObject({
      enabled: false,
    });
    await portal.audit({
      actor: { oid: 'oid-admin', name: 'Admin' },
      action: 'conversation.reveal',
      entityType: 'conversation',
      entityId: 'x',
    });
    const { data } = await client
      .from('audit_log')
      .select('action, actor')
      .eq('actor', 'oid-admin')
      .order('id', { ascending: false })
      .limit(2);
    expect(data?.map((r) => r.action)).toEqual(['conversation.reveal', 'capability.set']);
  });
});
