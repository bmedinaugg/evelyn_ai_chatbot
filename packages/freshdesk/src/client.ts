import type { Lang } from '@trainmore/i18n';
import { z } from 'zod';
import {
  FreshdeskError,
  FreshdeskPaginationError,
  FreshdeskRateLimitError,
  FreshdeskResponseError,
} from './errors.ts';
import { escapeHtml } from './html.ts';
import {
  articleSchema,
  type CreateTicketInput,
  createdTicketSchema,
  type FreshdeskArticle,
} from './schemas.ts';

export type FreshdeskClientOptions = {
  domain: string;
  apiKey: string;
  fetch?: typeof fetch;
};

export interface FreshdeskClient {
  listFolderArticles(folderId: number, lang: Lang): Promise<FreshdeskArticle[]>;
  createTicket(input: CreateTicketInput): Promise<{ id: number }>;
}

const PER_PAGE = 100;
const MAX_PAGES = 50;
const TICKET_STATUS_OPEN = 2;
const TICKET_PRIORITY_LOW = 1;
const TICKET_SOURCE_CHAT = 7;

export function createFreshdeskClient(opts: FreshdeskClientOptions): FreshdeskClient {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = `https://${opts.domain}/api/v2`;
  const authorization = `Basic ${btoa(`${opts.apiKey}:X`)}`;

  async function request(url: string, endpoint: string, init: RequestInit = {}): Promise<Response> {
    const response = await doFetch(url, {
      ...init,
      headers: { authorization, 'content-type': 'application/json', ...init.headers },
    });
    if (response.status === 429) {
      await response.body?.cancel();
      throw new FreshdeskRateLimitError(
        endpoint,
        parseSeconds(response.headers.get('retry-after')),
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new FreshdeskError(response.status, endpoint);
    }
    return response;
  }

  async function parse<T>(response: Response, endpoint: string, schema: z.ZodType<T>): Promise<T> {
    const json: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new FreshdeskResponseError(response.status, endpoint);
    return parsed.data;
  }

  return {
    async listFolderArticles(folderId, lang) {
      const endpoint = `/solutions/folders/${folderId}/articles/${lang}`;
      const articles: FreshdeskArticle[] = [];
      let url = `${baseUrl}${endpoint}?per_page=${PER_PAGE}&page=1`;
      for (let page = 1; ; page += 1) {
        const response = await request(url, endpoint);
        const link = response.headers.get('link');
        const batch = await parse(response, endpoint, z.array(articleSchema));
        articles.push(...batch);

        const next = nextLink(link, url);
        // A full page without a next link may still have more: ask for the next page anyway.
        if (next === undefined && batch.length < PER_PAGE) return articles;
        if (page >= MAX_PAGES) {
          throw new FreshdeskPaginationError(endpoint, `more than ${MAX_PAGES} pages`);
        }
        if (next === null) throw new FreshdeskPaginationError(endpoint, 'unreadable next link');
        const nextUrl = next ?? `${baseUrl}${endpoint}?per_page=${PER_PAGE}&page=${page + 1}`;
        // The Authorization header goes with every request: never leave our API host.
        if (!nextUrl.startsWith(`${baseUrl}/`)) {
          throw new FreshdeskPaginationError(endpoint, 'next link points to another host');
        }
        url = nextUrl;
      }
    },

    async createTicket(input) {
      const endpoint = '/tickets';
      const body = {
        email: input.email,
        subject: input.subject,
        description: escapeHtml(input.descriptionText).replace(/\n/g, '<br>'),
        tags: input.tags,
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        status: TICKET_STATUS_OPEN,
        priority: TICKET_PRIORITY_LOW,
        source: TICKET_SOURCE_CHAT,
      };
      const response = await request(`${baseUrl}${endpoint}`, endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return parse(response, endpoint, createdTicketSchema);
    },
  };
}

/** Absolute next-page URL, undefined when there is none, null when the header is unreadable. */
function nextLink(header: string | null, currentUrl: string): string | null | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const match = /<([^>]*)>\s*;\s*rel="?next"?/i.exec(part);
    if (match) {
      try {
        return new URL(match[1] ?? '', currentUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return undefined;
}

function parseSeconds(raw: string | null): number | undefined {
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
