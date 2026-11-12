import { afterAll, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createSupabaseConversationRepository,
  createSupabaseScenarioRepository,
} from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey)
  throw new Error('Supabase env missing: run via `pnpm --filter @trainmore/db test:integration`');
const client = createServiceClient({ url, serviceRoleKey });
const scenarios = createSupabaseScenarioRepository(client);
const conversations = createSupabaseConversationRepository(client);
const createdScenarios: string[] = [];
const createdConversations: string[] = [];

afterAll(async () => {
  await client.from('conversations').delete().in('id', createdConversations);
  await client.from('scenarios').delete().in('id', createdScenarios);
});

const content = {
  triggersNl: ['Mag ik mijn hond meenemen naar de sportschool?'],
  triggersEn: ['Can I bring my dog to the gym?'],
  answerNl: 'Nee, huisdieren zijn niet toegestaan in onze clubs.',
  answerEn: 'No, pets are not allowed in our clubs.',
  statuses: [],
  articleId: null,
};

describe('scenario repository', () => {
  it('drafts, publishes with four eyes, finds and lists a scenario', async () => {
    const created = await scenarios.create(content, { oid: 'oid-a', name: 'Agent' });
    createdScenarios.push(created.scenarioId);
    expect(await scenarios.publish(created.versionId, { oid: 'oid-a', name: 'Agent' })).toBe(
      'own_version',
    );
    // Drafts are never offered (other local data may hold published scenarios).
    expect(
      (await scenarios.search('hond sportschool', 'nl', 3)).map((h) => h.versionId),
    ).not.toContain(created.versionId);
    expect(await scenarios.publish(created.versionId, { oid: 'oid-b', name: 'Approver' })).toBe(
      'ok',
    );

    const hits = await scenarios.search('mag mijn hond mee', 'nl', 3);
    expect(hits.find((h) => h.versionId === created.versionId)).toMatchObject({
      versionId: created.versionId,
      answerNl: 'Nee, huisdieren zijn niet toegestaan in onze clubs.',
      statuses: [],
      articleId: null,
    });

    const detail = await scenarios.get(created.scenarioId);
    expect(detail?.versions).toEqual([
      expect.objectContaining({
        version: 1,
        status: 'published',
        authorName: 'Agent',
        publishedByName: 'Approver',
      }),
    ]);
    expect((await scenarios.list()).find((s) => s.id === created.scenarioId)).toMatchObject({
      publishedVersion: 1,
      latestVersion: 1,
      latestVersionId: created.versionId,
      archived: false,
    });

    const v2 = await scenarios.addVersion(
      created.scenarioId,
      { ...content, answerNl: 'Nee.' },
      { oid: 'oid-b', name: 'Approver' },
    );
    expect(
      (await scenarios.get(created.scenarioId))?.versions.map((v) => [v.version, v.status]),
    ).toEqual([
      [1, 'published'],
      [2, 'draft'],
    ]);
    expect(await scenarios.archive(created.scenarioId, { oid: 'oid-b', name: 'Approver' })).toBe(
      'ok',
    );
    expect(await scenarios.publish(v2, { oid: 'oid-a', name: 'Agent' })).toBe('archived');
  });

  it('stores which approved version a bot reply showed', async () => {
    const created = await scenarios.create(content, { oid: 'oid-a', name: 'Agent' });
    createdScenarios.push(created.scenarioId);
    const { id } = await conversations.create({ tokenHash: 'scenario-test', lang: 'nl' });
    createdConversations.push(id);
    const claim = (await conversations.claimTurn(id)) as string;
    await conversations.appendTurn({
      conversationId: id,
      claimId: claim,
      user: { displayText: 'Hond?', apiContent: 'q' },
      assistant: {
        displayText: content.answerNl,
        apiContent: [],
        outcome: 'answered',
        scenarioVersionId: created.versionId,
      },
      flags: [],
    });
    const { data } = await client
      .from('messages')
      .select('scenario_version_id')
      .eq('conversation_id', id)
      .eq('role', 'assistant')
      .single();
    expect(data?.scenario_version_id).toBe(created.versionId);
  });

  it('rejects invalid content', async () => {
    await expect(
      scenarios.create({ ...content, triggersNl: [] }, { oid: 'o', name: 'n' }),
    ).rejects.toThrow();
  });
});
