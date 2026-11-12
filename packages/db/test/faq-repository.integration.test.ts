import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createServiceClient,
  createSupabaseFaqRepository,
  type FaqArticleRecord,
} from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !serviceRoleKey || !anonKey) {
  throw new Error(
    'Supabase env missing: start Supabase (pnpm --filter @trainmore/db db:start) and run via `pnpm --filter @trainmore/db test:integration`',
  );
}

const client = createServiceClient({ url, serviceRoleKey });
const repo = createSupabaseFaqRepository(client);
const IDS = [990001, 990002, 990003];

function record(id: number, overrides: Partial<FaqArticleRecord> = {}): FaqArticleRecord {
  return {
    id,
    folderId: 900001,
    nl: {
      title: `Lidmaatschap bevriezen ${id}`,
      body: 'Je kunt je lidmaatschap tijdelijk bevriezen.',
      url: `https://portal.test/nl/support/solutions/articles/${id}`,
    },
    en: {
      title: `Freeze membership ${id}`,
      body: 'You can temporarily freeze your membership.',
      url: `https://portal.test/en/support/solutions/articles/${id}`,
    },
    contentHash: `hash-${id}`,
    freshdeskUpdatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

// Real Freshdesk ids are 12 digits; used to check request-size limits.
const BULK_FROM = 103000990000;
const BULK_COUNT = 1000;

async function cleanup(): Promise<void> {
  const { error } = await client.from('faq_articles').delete().in('id', IDS);
  if (error) throw error;
  const bulk = await client
    .from('faq_articles')
    .delete()
    .gte('id', BULK_FROM)
    .lt('id', BULK_FROM + BULK_COUNT);
  if (bulk.error) throw bulk.error;
}

beforeEach(cleanup);
afterAll(cleanup);

describe('SupabaseFaqRepository', () => {
  it('upsert then search finds the article in the preferred language', async () => {
    await repo.upsert([record(990001)]);
    const hits = await repo.search('bevriezen', 'nl');
    expect(hits.find((h) => h.articleId === 990001)).toMatchObject({
      lang: 'nl',
      url: 'https://portal.test/nl/support/solutions/articles/990001',
    });
  });

  it('search falls back to the other language', async () => {
    await repo.upsert([record(990002, { en: null })]);
    const hit = (await repo.search('bevriezen', 'en')).find((h) => h.articleId === 990002);
    expect(hit?.lang).toBe('nl');
  });

  it('softDeleteAllExcept hides articles from search and countActive', async () => {
    await repo.upsert([record(990001), record(990002)]);
    const before = await repo.countActive();
    const keep = [...(await repo.getActiveContentHashes()).keys()].filter((id) => id !== 990002);
    expect(await repo.softDeleteAllExcept(keep)).toBe(1);
    expect(await repo.countActive()).toBe(before - 1);
    expect((await repo.search('bevriezen', 'nl')).map((h) => h.articleId)).not.toContain(990002);
  });

  it('upsert clears deleted_at', async () => {
    await repo.upsert([record(990003)]);
    const keep = [...(await repo.getActiveContentHashes()).keys()].filter((id) => id !== 990003);
    await repo.softDeleteAllExcept(keep);
    await repo.upsert([record(990003)]);
    expect((await repo.getActiveContentHashes()).get(990003)).toBe('hash-990003');
  });

  it('getActiveContentHashes returns active ids only', async () => {
    await repo.upsert([record(990001), record(990002)]);
    const keep = [...(await repo.getActiveContentHashes()).keys()].filter((id) => id !== 990001);
    await repo.softDeleteAllExcept(keep);
    const hashes = await repo.getActiveContentHashes();
    expect(hashes.has(990001)).toBe(false);
    expect(hashes.get(990002)).toBe('hash-990002');
  });

  it('getActiveSummaries reports folder and languages', async () => {
    await repo.upsert([record(990001), record(990002, { en: null })]);
    const summaries = await repo.getActiveSummaries();
    expect(summaries.find((a) => a.id === 990001)).toEqual({
      id: 990001,
      folderId: 900001,
      contentHash: 'hash-990001',
      languages: ['nl', 'en'],
    });
    expect(summaries.find((a) => a.id === 990002)?.languages).toEqual(['nl']);
  });

  it('soft-deletes with a thousand 12-digit ids without hitting URL limits', async () => {
    const bulk = Array.from({ length: BULK_COUNT }, (_, i) => record(BULK_FROM + i));
    await repo.upsert(bulk);
    const others = [...(await repo.getActiveContentHashes()).keys()].filter(
      (id) => id < BULK_FROM || id >= BULK_FROM + BULK_COUNT,
    );
    const keep = [...others, ...bulk.slice(0, 900).map((a) => a.id)];
    expect(await repo.softDeleteAllExcept(keep)).toBe(100);
    const active = await repo.getActiveContentHashes();
    expect(active.has(BULK_FROM)).toBe(true);
    expect(active.has(BULK_FROM + 950)).toBe(false);
  });

  it('the anon key cannot read faq_articles or call search_faq', async () => {
    await repo.upsert([record(990001)]);
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const table = await anon.from('faq_articles').select('id').eq('id', 990001);
    expect(table.data ?? []).toEqual([]);
    const rpc = await anon.rpc('search_faq', { query: 'bevriezen', preferred_lang: 'nl' });
    expect(rpc.data ?? []).toEqual([]);
    expect(rpc.error).not.toBeNull();
  });
});
