import type { Lang } from '@trainmore/i18n';
import { z } from 'zod';
import { DbError, type ServiceClient } from './client.ts';
import type { FaqArticleRecord, FaqRepository, FaqSearchHit } from './faq-types.ts';

const PAGE_SIZE = 1000;

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
  return {
    async getActiveContentHashes() {
      const hashes = new Map<number, string>();
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await client
          .from('faq_articles')
          .select('id, content_hash')
          .is('deleted_at', null)
          .order('id')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new DbError('faq_articles select', error.code);
        for (const row of data) hashes.set(row.id, row.content_hash);
        if (data.length < PAGE_SIZE) return hashes;
      }
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
      let query = client
        .from('faq_articles')
        .update({ deleted_at: new Date().toISOString() })
        .is('deleted_at', null);
      if (keepIds.length > 0) query = query.not('id', 'in', `(${keepIds.map(Number).join(',')})`);
      const { data, error } = await query.select('id');
      if (error) throw new DbError('faq_articles soft delete', error.code);
      return data.length;
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
