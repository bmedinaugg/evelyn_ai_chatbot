import { readFileSync } from 'node:fs';
import type { FreshdeskArticle, FreshdeskClient } from '@trainmore/freshdesk';
import { z } from 'zod';

/** Synthetic folder used for local development and evals. Never real TrainMore content. */
export const FIXTURE_FOLDER_ID = 900001;
export const FIXTURE_CATEGORY_ID = 900000;
export const FIXTURE_PORTAL_ID = 900000;

const translationSchema = z.object({
  title: z.string().min(1),
  descriptionHtml: z.string().min(1),
  status: z.number().int(),
});

const fixtureSchema = z.array(
  z.object({
    id: z.number().int(),
    folderId: z.literal(FIXTURE_FOLDER_ID),
    updatedAt: z.string(),
    nl: translationSchema.nullable(),
    en: translationSchema.nullable(),
  }),
);

export type FixtureArticle = z.output<typeof fixtureSchema>[number];

export function fixtureArticles(): FixtureArticle[] {
  const raw = readFileSync(new URL('../fixtures/faq-articles.json', import.meta.url), 'utf8');
  return fixtureSchema.parse(JSON.parse(raw));
}

/** Serves the fixtures as if they were the Freshdesk Solutions folder FIXTURE_FOLDER_ID. */
export function fixtureFreshdeskClient(): Pick<
  FreshdeskClient,
  'listFolderArticles' | 'getFolder' | 'getCategory'
> {
  const articles = fixtureArticles();
  return {
    async getFolder(folderId) {
      return { id: folderId, visibility: 1, parentFolderId: null, categoryId: FIXTURE_CATEGORY_ID };
    },
    async getCategory(categoryId) {
      return { id: categoryId, visibleInPortals: [FIXTURE_PORTAL_ID] };
    },
    async listFolderArticles(folderId, lang) {
      if (folderId !== FIXTURE_FOLDER_ID) return [];
      return articles.flatMap((article): FreshdeskArticle[] => {
        const translation = article[lang];
        return translation
          ? [
              {
                id: article.id,
                folderId: article.folderId,
                title: translation.title,
                descriptionHtml: translation.descriptionHtml,
                status: translation.status,
                updatedAt: article.updatedAt,
              },
            ]
          : [];
      });
    },
  };
}
