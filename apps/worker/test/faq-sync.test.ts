import { Writable } from 'node:stream';
import type { FreshdeskArticle, FreshdeskClient } from '@trainmore/freshdesk';
import type { Lang } from '@trainmore/i18n';
import { createLogger } from '@trainmore/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { FaqSyncAbortedError, runFaqSync } from '../src/faq-sync.ts';
import {
  createInMemoryFaqRepository,
  type InMemoryFaqRepository,
} from './in-memory-faq-repository.ts';

type Listings = Record<number, Partial<Record<Lang, FreshdeskArticle[] | Error>>>;

type Folders = Record<
  number,
  { visibility: number; parentFolderId?: number; categoryId?: number | null } | Error
>;

let folders: Folders;
/** Portals per category; categories not listed are shown on the TrainMore portal (1). */
let categories: Record<number, number[] | null>;

function fakeFreshdesk(
  listings: Listings,
): Pick<FreshdeskClient, 'listFolderArticles' | 'getFolder' | 'getCategory'> {
  return {
    async getFolder(folderId) {
      const folder = folders[folderId] ?? { visibility: 1 };
      if (folder instanceof Error) throw folder;
      return {
        id: folderId,
        visibility: folder.visibility,
        parentFolderId: folder.parentFolderId ?? null,
        categoryId: folder.categoryId === undefined ? 50 : folder.categoryId,
      };
    },
    async getCategory(categoryId) {
      return {
        id: categoryId,
        visibleInPortals: categoryId in categories ? (categories[categoryId] ?? null) : [1],
      };
    },
    async listFolderArticles(folderId, lang) {
      const result = listings[folderId]?.[lang] ?? [];
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function article(
  id: number,
  title: string,
  status = 2,
  html = `<p>${title} body</p>`,
): FreshdeskArticle {
  return {
    id,
    folderId: 101,
    title,
    descriptionHtml: html,
    status,
    updatedAt: '2026-11-01T10:00:00Z',
  };
}

let repo: InMemoryFaqRepository;
let logOutput: string;
const logger = createLogger({
  name: 'test',
  level: 'info',
  destination: new Writable({
    write(chunk, _encoding, callback) {
      logOutput += chunk.toString();
      callback();
    },
  }),
});

function sync(listings: Listings, folderIds = [101], allowMassChange = false) {
  return runFaqSync({
    freshdesk: fakeFreshdesk(listings),
    repo,
    folderIds,
    portalUrl: 'https://portal.test',
    portalId: 1,
    logger,
    allowMassChange,
  });
}

const many = (count: number, folderId = 101) =>
  Array.from({ length: count }, (_, i) => ({ ...article(1000 + i, `A${i}`), folderId }));

beforeEach(() => {
  repo = createInMemoryFaqRepository();
  logOutput = '';
  folders = {};
  categories = {};
});

describe('runFaqSync', () => {
  it('stores a bilingual published article with both URLs', async () => {
    const result = await sync({
      101: { nl: [article(7, 'Opzeggen')], en: [article(7, 'Cancel')] },
    });
    expect(result).toEqual({ upserted: 1, unchanged: 0, deleted: 0, skippedUnpublished: 0 });
    const row = repo.rows.get(7);
    expect(row?.nl).toEqual({
      title: 'Opzeggen',
      body: 'Opzeggen body',
      url: 'https://portal.test/nl/support/solutions/articles/7',
    });
    expect(row?.en?.url).toBe('https://portal.test/en/support/solutions/articles/7');
  });

  it('stores an article published in one language only', async () => {
    await sync({ 101: { nl: [article(7, 'Opzeggen')], en: [article(7, 'Cancel', 1)] } });
    expect(repo.rows.get(7)?.en).toBeNull();
    expect(repo.rows.get(7)?.nl?.title).toBe('Opzeggen');
  });

  it('skips articles not published in any language', async () => {
    const result = await sync({
      101: { nl: [article(7, 'Concept', 1)], en: [article(7, 'Draft', 1)] },
    });
    expect(result.skippedUnpublished).toBe(1);
    expect(repo.rows.has(7)).toBe(false);
  });

  it('only upserts changed articles', async () => {
    const listings = { 101: { nl: [article(7, 'Opzeggen')], en: [article(7, 'Cancel')] } };
    await sync(listings);
    expect(await sync(listings)).toEqual({
      upserted: 0,
      unchanged: 1,
      deleted: 0,
      skippedUnpublished: 0,
    });
  });

  it('soft-deletes articles that disappeared', async () => {
    await sync({ 101: { nl: [article(7, 'Opzeggen'), article(8, 'Kluisjes')] } });
    const result = await sync({ 101: { nl: [article(8, 'Kluisjes')] } });
    expect(result.deleted).toBe(1);
    expect(repo.rows.get(7)?.deleted).toBe(true);
  });

  it('restores a republished article', async () => {
    await sync({ 101: { nl: [article(7, 'Opzeggen'), article(8, 'Kluisjes')] } });
    await sync({ 101: { nl: [article(8, 'Kluisjes')] } });
    const result = await sync({ 101: { nl: [article(7, 'Opzeggen'), article(8, 'Kluisjes')] } });
    expect(result.upserted).toBe(1);
    expect(repo.rows.get(7)?.deleted).toBe(false);
  });

  it('aborts without writing when a listing fails', async () => {
    await sync({ 101: { nl: [article(7, 'Opzeggen')] } });
    const calls = { ...repo.calls };
    const error = await sync(
      { 101: { nl: [article(7, 'Opzeggen gewijzigd')] }, 102: { en: new Error('HTTP 500') } },
      [101, 102],
    ).catch((e) => e);
    expect(error).toBeInstanceOf(FaqSyncAbortedError);
    expect(error.reason).toBe('fetch_failed');
    expect(repo.calls).toEqual(calls);
    expect(repo.rows.get(7)?.nl?.title).toBe('Opzeggen');
  });

  it('aborts when Freshdesk returns nothing but the DB has articles', async () => {
    await sync({ 101: { nl: [article(7, 'Opzeggen')] } });
    const error = await sync({ 101: { nl: [], en: [] } }).catch((e) => e);
    expect(error).toBeInstanceOf(FaqSyncAbortedError);
    expect(error.reason).toBe('empty_listing');
    expect(repo.rows.get(7)?.deleted).toBe(false);
  });

  it('aborts when one language listing is empty while stored articles have that language', async () => {
    await sync({ 101: { nl: [article(7, 'Opzeggen')], en: [article(7, 'Cancel')] } });
    const error = await sync({ 101: { nl: [article(7, 'Opzeggen')], en: [] } }).catch((e) => e);
    expect(error).toBeInstanceOf(FaqSyncAbortedError);
    expect(error.reason).toBe('empty_listing');
    expect(repo.rows.get(7)?.en?.title).toBe('Cancel');
  });

  it('aborts when one folder is empty while it has stored articles', async () => {
    await sync(
      {
        101: { nl: [article(7, 'Opzeggen')] },
        102: { nl: [{ ...article(8, 'Kluisjes'), folderId: 102 }] },
      },
      [101, 102],
    );
    const error = await sync(
      { 101: { nl: [article(7, 'Opzeggen')] }, 102: { nl: [] } },
      [101, 102],
    ).catch((e) => e);
    expect(error.reason).toBe('empty_listing');
    expect(repo.rows.get(8)?.deleted).toBe(false);
  });

  it('aborts before writing when too many articles would be deleted', async () => {
    await sync({ 101: { nl: many(20) } });
    const calls = { ...repo.calls };
    const error = await sync({ 101: { nl: many(10) } }).catch((e) => e);
    expect(error).toBeInstanceOf(FaqSyncAbortedError);
    expect(error.reason).toBe('mass_change');
    expect(repo.calls).toEqual(calls);
  });

  it('aborts when many articles would lose a translation', async () => {
    const bilingual = { nl: many(20), en: many(20) };
    await sync({ 101: bilingual });
    const error = await sync({ 101: { nl: many(20), en: many(2) } }).catch((e) => e);
    expect(error.reason).toBe('mass_change');
    expect(repo.rows.get(1010)?.en).not.toBeNull();
  });

  it('applies a large change when explicitly allowed', async () => {
    await sync({ 101: { nl: many(20) } });
    const result = await sync({ 101: { nl: many(10) } }, [101], true);
    expect(result.deleted).toBe(10);
  });

  describe('public folders only', () => {
    it('never adds articles from a folder that is not visible to all users', async () => {
      folders = { 202: { visibility: 2 } };
      await sync(
        {
          101: { nl: [article(7, 'Opzeggen')] },
          202: { nl: [{ ...article(8, 'Intern'), folderId: 202 }] },
        },
        [101, 202],
      );
      expect(repo.rows.has(7)).toBe(true);
      expect(repo.rows.has(8)).toBe(false);
      expect(logOutput).toContain('folder is not public');
    });

    it('skips a public folder inside a non-public parent', async () => {
      folders = { 202: { visibility: 1, parentFolderId: 200 }, 200: { visibility: 3 } };
      await sync({ 202: { nl: [{ ...article(8, 'Intern'), folderId: 202 }] } }, [202]);
      expect(repo.rows.has(8)).toBe(false);
    });

    it('removes stored articles once their folder stops being public, even many at once', async () => {
      await sync({ 101: { nl: [article(7, 'Opzeggen')] }, 202: { nl: many(10, 202) } }, [101, 202]);
      folders = { 202: { visibility: 2 } };
      const result = await sync(
        { 101: { nl: [article(7, 'Opzeggen')] }, 202: { nl: many(10, 202) } },
        [101, 202],
      );
      expect(result.deleted).toBe(10);
      expect(repo.rows.get(7)?.deleted).toBeFalsy();
      expect(repo.rows.get(1000)?.deleted).toBe(true);
    });

    it('skips a public folder whose category is shown on another brand portal', async () => {
      folders = { 202: { visibility: 1, categoryId: 60 } };
      categories = { 60: [2] };
      await sync({ 202: { nl: [{ ...article(8, 'Clubsportive'), folderId: 202 }] } }, [202]);
      expect(repo.rows.has(8)).toBe(false);
    });

    it('skips a folder whose category has no portal list', async () => {
      folders = { 202: { visibility: 1, categoryId: 60 } };
      categories = { 60: null };
      await sync({ 202: { nl: [{ ...article(8, 'Intern'), folderId: 202 }] } }, [202]);
      expect(repo.rows.has(8)).toBe(false);
    });

    it('skips a folder without a category', async () => {
      folders = { 202: { visibility: 1, categoryId: null } };
      await sync({ 202: { nl: [{ ...article(8, 'Los'), folderId: 202 }] } }, [202]);
      expect(repo.rows.has(8)).toBe(false);
    });

    it('aborts without writing when a folder cannot be read', async () => {
      folders = { 101: new Error('503') };
      await expect(sync({ 101: { nl: [article(7, 'Opzeggen')] } })).rejects.toMatchObject({
        reason: 'fetch_failed',
      });
      expect(repo.rows.size).toBe(0);
    });
  });

  it('converts article HTML to text', async () => {
    await sync({ 101: { nl: [article(7, 'Hoi', 2, '<p>Hoi&nbsp;<b>daar</b></p>')] } });
    expect(repo.rows.get(7)?.nl?.body).toBe('Hoi daar');
  });

  it('logs counts only, never article content', async () => {
    await sync({ 101: { nl: [article(7, 'Opzeggen', 2, '<p>Geheime inhoud xyz</p>')] } });
    expect(logOutput).toContain('upserted');
    expect(logOutput).not.toContain('Geheime inhoud xyz');
    expect(logOutput).not.toContain('Opzeggen');
  });
});
