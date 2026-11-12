import type { FaqArticleRecord, FaqRepository } from '@trainmore/db';

export type InMemoryFaqRepository = FaqRepository & {
  rows: Map<number, FaqArticleRecord & { deleted: boolean }>;
  calls: { upsert: number; softDelete: number };
};

export function createInMemoryFaqRepository(): InMemoryFaqRepository {
  const rows = new Map<number, FaqArticleRecord & { deleted: boolean }>();
  const calls = { upsert: 0, softDelete: 0 };
  return {
    rows,
    calls,
    async getActiveContentHashes() {
      return new Map(
        [...rows.values()].filter((r) => !r.deleted).map((r) => [r.id, r.contentHash]),
      );
    },
    async getActiveSummaries() {
      return [...rows.values()]
        .filter((r) => !r.deleted)
        .map((r) => ({
          id: r.id,
          folderId: r.folderId,
          contentHash: r.contentHash,
          languages: (['nl', 'en'] as const).filter((lang) => r[lang] !== null),
        }));
    },
    async countActive() {
      return [...rows.values()].filter((r) => !r.deleted).length;
    },
    async upsert(articles) {
      calls.upsert += 1;
      for (const article of articles) rows.set(article.id, { ...article, deleted: false });
    },
    async softDeleteAllExcept(keepIds) {
      calls.softDelete += 1;
      let deleted = 0;
      for (const row of rows.values()) {
        if (!row.deleted && !keepIds.includes(row.id)) {
          row.deleted = true;
          deleted += 1;
        }
      }
      return deleted;
    },
    async search() {
      throw new Error('not used by the sync');
    },
  };
}
