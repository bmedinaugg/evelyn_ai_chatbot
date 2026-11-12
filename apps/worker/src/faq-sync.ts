import { createHash } from 'node:crypto';
import type { FaqArticleRecord, FaqRepository, FaqTranslation } from '@trainmore/db';
import { type FreshdeskArticle, type FreshdeskClient, htmlToText } from '@trainmore/freshdesk';
import type { Lang } from '@trainmore/i18n';
import type { Logger } from '@trainmore/shared';

const LANGS: readonly Lang[] = ['nl', 'en'];
const PUBLISHED = 2;

export type FaqSyncDeps = {
  freshdesk: Pick<FreshdeskClient, 'listFolderArticles'>;
  repo: FaqRepository;
  folderIds: number[];
  portalUrl: string;
  logger: Logger;
};

export type FaqSyncResult = {
  upserted: number;
  unchanged: number;
  deleted: number;
  skippedUnpublished: number;
};

export class FaqSyncAbortedError extends Error {
  readonly reason: 'fetch_failed' | 'empty_listing';

  constructor(reason: 'fetch_failed' | 'empty_listing', options?: ErrorOptions) {
    super(`FAQ sync aborted: ${reason}`, options);
    this.name = 'FaqSyncAbortedError';
    this.reason = reason;
  }
}

type Merged = {
  folderId: number;
  updatedAt: string[];
  translations: Partial<Record<Lang, FaqTranslation>>;
  seenUnpublished: boolean;
};

/**
 * Mirrors the published Freshdesk FAQ articles into the repository.
 * Fetches everything before writing anything, so a partial failure never deletes content.
 */
export async function runFaqSync(deps: FaqSyncDeps): Promise<FaqSyncResult> {
  const listings: Array<{ lang: Lang; articles: FreshdeskArticle[] }> = [];
  try {
    for (const folderId of deps.folderIds) {
      for (const lang of LANGS) {
        listings.push({ lang, articles: await deps.freshdesk.listFolderArticles(folderId, lang) });
      }
    }
  } catch (error) {
    deps.logger.error({ err: error }, 'faq sync aborted: listing failed');
    throw new FaqSyncAbortedError('fetch_failed', { cause: error });
  }

  const merged = new Map<number, Merged>();
  for (const { lang, articles } of listings) {
    for (const article of articles) {
      const entry = merged.get(article.id) ?? {
        folderId: article.folderId,
        updatedAt: [],
        translations: {},
        seenUnpublished: false,
      };
      if (article.status === PUBLISHED) {
        entry.translations[lang] = {
          title: article.title,
          body: htmlToText(article.descriptionHtml),
          url: `${deps.portalUrl}/${lang}/support/solutions/articles/${article.id}`,
        };
        entry.updatedAt.push(article.updatedAt);
      } else {
        entry.seenUnpublished = true;
      }
      merged.set(article.id, entry);
    }
  }

  const records: FaqArticleRecord[] = [];
  let skippedUnpublished = 0;
  for (const [id, entry] of merged) {
    const nl = entry.translations.nl ?? null;
    const en = entry.translations.en ?? null;
    if (!nl && !en) {
      skippedUnpublished += 1;
      continue;
    }
    records.push({
      id,
      folderId: entry.folderId,
      nl,
      en,
      contentHash: createHash('sha256')
        .update(JSON.stringify([entry.folderId, nl, en]))
        .digest('hex'),
      freshdeskUpdatedAt: entry.updatedAt.sort().at(-1) ?? new Date(0).toISOString(),
    });
  }

  if (records.length === 0 && (await deps.repo.countActive()) > 0) {
    deps.logger.error('faq sync aborted: Freshdesk returned no published articles');
    throw new FaqSyncAbortedError('empty_listing');
  }

  const activeHashes = await deps.repo.getActiveContentHashes();
  const changed = records.filter((record) => activeHashes.get(record.id) !== record.contentHash);
  if (changed.length > 0) await deps.repo.upsert(changed);
  const deleted = await deps.repo.softDeleteAllExcept(records.map((record) => record.id));

  const result: FaqSyncResult = {
    upserted: changed.length,
    unchanged: records.length - changed.length,
    deleted,
    skippedUnpublished,
  };
  deps.logger.info(result, 'faq sync finished');
  return result;
}
