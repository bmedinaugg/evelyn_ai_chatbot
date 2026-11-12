import type { Lang } from '@trainmore/i18n';
import { z } from 'zod';
import { DbError, type ServiceClient } from './client.ts';
import type {
  ActiveFaqSummary,
  FaqArticleRecord,
  FaqRepository,
  FaqSearchHit,
} from './faq-types.ts';

const PAGE_SIZE = 1000;
/** Ids per update request; keeps the PostgREST URL far below proxy limits (~8 KB). */
const ID_CHUNK = 200;

const searchRowSchema = z
  .object({
    article_id: z.number().int(),
    lang: z.enum(['nl', 'en']),
    title: z.string(),
    body: z.string(),
    url: z.string(),
    rank: z.number(),
  })
  .transform(
    (row): FaqSearchHit => ({
      articleId: row.article_id,
      lang: row.lang,
      title: row.title,
      body: row.body,
      url: row.url,
      rank: row.rank,
    }),
  );

export function createSupabaseFaqRepository(client: ServiceClient): FaqRepository {
  async function getActiveSummaries(): Promise<ActiveFaqSummary[]> {
    const summaries: ActiveFaqSummary[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('faq_articles')
        .select('id, folder_id, content_hash, title_nl, title_en')
        .is('deleted_at', null)
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new DbError('faq_articles select', error.code);
      for (const row of data) {
        summaries.push({
          id: row.id,
          folderId: row.folder_id,
          contentHash: row.content_hash,
          languages: [
            ...(row.title_nl === null ? [] : (['nl'] as const)),
            ...(row.title_en === null ? [] : (['en'] as const)),
          ],
        });
      }
      if (data.length < PAGE_SIZE) return summaries;
    }
  }

  return {
    getActiveSummaries,

    async getActiveContentHashes() {
      return new Map((await getActiveSummaries()).map((a) => [a.id, a.contentHash]));
    },

    async countActive() {
      const { count, error } = await client
        .from('faq_articles')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null);
      if (error) throw new DbError('faq_articles count', error.code);
      return count ?? 0;
    },

    async upsert(articles) {
      if (articles.length === 0) return;
      const now = new Date().toISOString();
      const { error } = await client.from('faq_articles').upsert(
        articles.map((a: FaqArticleRecord) => ({
          id: a.id,
          folder_id: a.folderId,
          title_nl: a.nl?.title ?? null,
          body_nl: a.nl?.body ?? null,
          url_nl: a.nl?.url ?? null,
          title_en: a.en?.title ?? null,
          body_en: a.en?.body ?? null,
          url_en: a.en?.url ?? null,
          content_hash: a.contentHash,
          freshdesk_updated_at: a.freshdeskUpdatedAt,
          synced_at: now,
          deleted_at: null,
        })),
        { onConflict: 'id' },
      );
      if (error) throw new DbError('faq_articles upsert', error.code);
    },

    async softDeleteAllExcept(keepIds) {
      // Compute the ids to delete here and send them in small chunks: a "not in (all kept ids)"
      // filter grows with the FAQ and eventually exceeds URL limits (414).
      const keep = new Set(keepIds);
      const toDelete = (await getActiveSummaries()).map((a) => a.id).filter((id) => !keep.has(id));
      const deletedAt = new Date().toISOString();
      let deleted = 0;
      for (let i = 0; i < toDelete.length; i += ID_CHUNK) {
        const { data, error } = await client
          .from('faq_articles')
          .update({ deleted_at: deletedAt })
          .in('id', toDelete.slice(i, i + ID_CHUNK))
          .is('deleted_at', null)
          .select('id');
        if (error) throw new DbError('faq_articles soft delete', error.code);
        deleted += data.length;
      }
      return deleted;
    },

    async search(query: string, preferredLang: Lang, limit = 5) {
      const { data, error } = await client.rpc('search_faq', {
        query,
        preferred_lang: preferredLang,
        max_results: limit,
      });
      if (error) throw new DbError('search_faq', error.code);
      return z.array(searchRowSchema).parse(data);
    },
  };
}
