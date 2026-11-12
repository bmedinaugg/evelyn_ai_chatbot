import { z } from 'zod';
import { MagiclineError, MagiclineRateLimitError, MagiclineResponseError } from './errors.ts';
import type { paths } from './generated/schema.d.ts';
import { type CustomerLookup, customerLookupSchema, emailSchema } from './schemas.ts';

type CrossStudioSearchBody =
  paths['/v1/cross-studio/customers/search']['post']['requestBody']['content']['application/json'];

export type MagiclineClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
};

export interface MagiclineClient {
  searchCustomersCrossStudio(email: string): Promise<CustomerLookup[]>;
}

export function createMagiclineClient(opts: MagiclineClientOptions): MagiclineClient {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');

  async function post<T>(endpoint: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await doFetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'X-API-KEY': opts.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 429) {
      await response.body?.cancel();
      throw new MagiclineRateLimitError(endpoint, parseSeconds(response.headers));
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new MagiclineError(response.status, endpoint);
    }
    const json: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new MagiclineResponseError(response.status, endpoint);
    }
    return parsed.data;
  }

  return {
    async searchCustomersCrossStudio(email) {
      const body: CrossStudioSearchBody = { email: emailSchema.parse(email) };
      return post('/v1/cross-studio/customers/search', body, z.array(customerLookupSchema));
    },
  };
}

function parseSeconds(headers: Headers): number | undefined {
  const raw = headers.get('x-ratelimit-reset') ?? headers.get('retry-after');
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
