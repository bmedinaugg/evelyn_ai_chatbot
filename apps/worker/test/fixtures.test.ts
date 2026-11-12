import { Writable } from 'node:stream';
import { createLogger } from '@trainmore/shared';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/cli.ts';
import { runFaqSync } from '../src/faq-sync.ts';
import {
  FIXTURE_FOLDER_ID,
  fixtureArticles,
  fixtureFreshdeskClient,
} from '../src/fixture-source.ts';
import { createInMemoryFaqRepository } from './in-memory-faq-repository.ts';

const quietLogger = createLogger({
  name: 'test',
  level: 'info',
  destination: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
});

describe('FAQ fixtures', () => {
  it('every fixture validates and has at least one published language', () => {
    const articles = fixtureArticles();
    expect(articles).toHaveLength(8);
    for (const article of articles) {
      expect(article.nl?.status === 2 || article.en?.status === 2).toBe(true);
    }
  });

  it('has nl-only and en-only articles for fallback tests', () => {
    const articles = fixtureArticles();
    expect(articles.some((a) => a.nl && !a.en)).toBe(true);
    expect(articles.some((a) => a.en && !a.nl)).toBe(true);
  });

  it('every body is marked synthetic', () => {
    for (const article of fixtureArticles()) {
      for (const translation of [article.nl, article.en]) {
        if (translation) {
          expect(translation.descriptionHtml).toContain(
            '[SYNTHETIC TEST CONTENT — not TrainMore policy]',
          );
        }
      }
    }
  });

  it('serves the fixture folder only', async () => {
    const client = fixtureFreshdeskClient();
    expect((await client.listFolderArticles(FIXTURE_FOLDER_ID, 'nl')).length).toBe(7);
    expect(await client.listFolderArticles(123, 'nl')).toEqual([]);
  });

  it('seeding twice is idempotent', async () => {
    const repo = createInMemoryFaqRepository();
    const deps = {
      freshdesk: fixtureFreshdeskClient(),
      repo,
      folderIds: [FIXTURE_FOLDER_ID],
      portalUrl: 'https://portal.test',
      logger: quietLogger,
    };
    expect((await runFaqSync(deps)).upserted).toBe(8);
    expect((await runFaqSync(deps)).upserted).toBe(0);
  });

  it('seed refuses outside APP_ENV=local', async () => {
    await expect(
      runCommand('seed-faq-fixtures', {
        NODE_ENV: 'test',
        APP_ENV: 'preprod',
        AWS_REGION: 'eu-west-1',
      }),
    ).rejects.toThrow(/APP_ENV=local/);
  });
});
