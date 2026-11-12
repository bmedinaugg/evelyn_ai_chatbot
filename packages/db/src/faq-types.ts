import type { Lang } from '@trainmore/i18n';

export type FaqTranslation = { title: string; body: string; url: string };

export type FaqArticleRecord = {
  id: number;
  folderId: number;
  nl: FaqTranslation | null;
  en: FaqTranslation | null;
  contentHash: string;
  freshdeskUpdatedAt: string;
};

export type FaqSearchHit = {
  articleId: number;
  lang: Lang;
  title: string;
  body: string;
  url: string;
  rank: number;
};

export type ActiveFaqSummary = {
  id: number;
  folderId: number;
  contentHash: string;
  languages: Lang[];
};

export interface FaqRepository {
  /** Active (not soft-deleted) articles with the languages they have. */
  getActiveSummaries(): Promise<ActiveFaqSummary[]>;
  /** Content hashes of active (not soft-deleted) articles. */
  getActiveContentHashes(): Promise<Map<number, string>>;
  countActive(): Promise<number>;
  /** Inserts or updates; clears deleted_at and sets synced_at. */
  upsert(articles: FaqArticleRecord[]): Promise<void>;
  /** Soft-deletes active articles not in keepIds; returns how many were deleted. */
  softDeleteAllExcept(keepIds: number[]): Promise<number>;
  search(query: string, preferredLang: Lang, limit?: number): Promise<FaqSearchHit[]>;
}
