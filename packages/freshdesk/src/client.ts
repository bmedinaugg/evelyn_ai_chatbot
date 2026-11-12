import type { Lang } from '@trainmore/i18n';
import { z } from 'zod';
import { FreshdeskError, FreshdeskRateLimitError, FreshdeskResponseError } from './errors.ts';
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
      let url: string | undefined = `${baseUrl}${endpoint}?per_page=100&page=1`;
      for (let page = 0; url && page < MAX_PAGES; page += 1) {
        const response = await request(url, endpoint);
        const next = nextLink(response.headers.get('link'));
        articles.push(...(await parse(response, endpoint, z.array(articleSchema))));
        // Only follow links on our own API host: the Authorization header goes with them.
        url = next?.startsWith(`${baseUrl}/`) ? next : undefined;
      }
      return articles;
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

function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function parseSeconds(raw: string | null): number | undefined {
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
