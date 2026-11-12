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

function fakeFreshdesk(listings: Listings): Pick<FreshdeskClient, 'listFolderArticles'> {
  return {
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

function sync(listings: Listings, folderIds = [101]) {
  return runFaqSync({
    freshdesk: fakeFreshdesk(listings),
    repo,
    folderIds,
    portalUrl: 'https://portal.test',
    logger,
  });
}

beforeEach(() => {
  repo = createInMemoryFaqRepository();
  logOutput = '';
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
