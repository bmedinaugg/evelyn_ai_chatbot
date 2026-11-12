import { afterAll, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createSupabaseConversationRepository,
  createSupabaseMetricsRepository,
} from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey)
  throw new Error('Supabase env missing: run via `pnpm --filter @trainmore/db test:integration`');
const client = createServiceClient({ url, serviceRoleKey });
const metrics = createSupabaseMetricsRepository(client);
const conversations = createSupabaseConversationRepository(client);
const created: string[] = [];
const DAY = '2001-02-03';

afterAll(async () => {
  await client.from('daily_reports').delete().eq('day', DAY);
  await client.from('conversations').delete().in('id', created);
});

describe('metrics repository', () => {
  it('returns one validated row per day', async () => {
    const rows = await metrics.dailyMetrics('2001-02-01', '2001-02-03');
    expect(rows.map((r) => r.day)).toEqual(['2001-02-01', '2001-02-02', '2001-02-03']);
    expect(rows[0]).toEqual({
      day: '2001-02-01',
      conversations: 0,
      resolved: 0,
      escalations: 0,
      thumbsUp: 0,
      thumbsDown: 0,
      approvedAnswers: 0,
      logins: 0,
      flags: {},
    });
  });

  it('rejects a range over 92 days', async () => {
    await expect(metrics.dailyMetrics('2001-01-01', '2001-06-01')).rejects.toThrow();
  });

  it('lists flagged questions with their reasons', async () => {
    const { id } = await conversations.create({ tokenHash: 'metrics', lang: 'nl' });
    created.push(id);
    const { data: msgs, error } = await client
      .from('messages')
      .insert([
        {
          conversation_id: id,
          role: 'user',
          display_text: 'Waar is de sauna?',
          api_content: '"q"',
        },
        {
          conversation_id: id,
          role: 'assistant',
          display_text: '?',
          api_content: [],
          outcome: 'no_match',
        },
      ])
      .select('id, role');
    expect(error).toBeNull();
    const reply = msgs?.find((m) => m.role === 'assistant');
    await client
      .from('flags')
      .insert({ conversation_id: id, message_id: reply?.id ?? null, reason: 'no_match' });

    const rows = await metrics.flaggedQuestions(
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
      500,
    );
    expect(rows.filter((r) => r.conversationId === id)).toEqual([
      {
        conversationId: id,
        messageId: reply?.id,
        reasons: ['no_match'],
        question: 'Waar is de sauna?',
      },
    ]);
  });

  it('pages through more flagged questions than one call returns', async () => {
    const { id } = await conversations.create({ tokenHash: 'metrics-paging', lang: 'nl' });
    created.push(id);
    for (const n of [1, 2, 3]) {
      const { data } = await client
        .from('messages')
        .insert([
          { conversation_id: id, role: 'user', display_text: `Paging ${n}`, api_content: '"q"' },
          {
            conversation_id: id,
            role: 'assistant',
            display_text: '?',
            api_content: [],
            outcome: 'no_match',
          },
        ])
        .select('id, role');
      const reply = data?.find((m) => m.role === 'assistant');
      await client
        .from('flags')
        .insert({ conversation_id: id, message_id: reply?.id ?? null, reason: 'no_match' });
    }
    const rows = await metrics.flaggedQuestions(
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
      500,
      { pageSize: 1 },
    );
    expect(rows.filter((r) => r.conversationId === id).map((r) => r.question)).toEqual([
      'Paging 1',
      'Paging 2',
      'Paging 3',
    ]);
  });

  it('claims, finishes and reads a report once', async () => {
    const claim = await metrics.claimReport(DAY, false);
    expect(claim).toEqual(expect.any(String));
    expect(await metrics.claimReport(DAY, false)).toBeNull();
    const topics = [{ labelNl: 'Sauna', labelEn: 'Sauna', count: 1, conversationIds: [] }];
    expect(
      await metrics.finishReport(DAY, claim ?? '', { recipientsCount: 2, clustered: true, topics }),
    ).toBe(true);
    expect(await metrics.getReport(DAY)).toMatchObject({ day: DAY, clustered: true, topics });
    expect(await metrics.getReport('2001-02-04')).toBeNull();
  });

  it('releases an unsent claim', async () => {
    await client.from('daily_reports').delete().eq('day', DAY);
    const claim = await metrics.claimReport(DAY, false);
    await metrics.releaseReport(DAY, claim ?? '');
    expect(await metrics.claimReport(DAY, false)).toEqual(expect.any(String));
  });
});
