import { z } from 'zod';
import {
  type BalanceInfo,
  balanceSchema,
  type ClassBookingInfo,
  checkinsSchema,
  classBookingsSchema,
  type MembershipInfo,
  membershipSchema,
  type PaymentInfo,
  upcomingPaymentsSchema,
  type VisitInfo,
} from './account-schemas.ts';
import { MagiclineError, MagiclineRateLimitError, MagiclineResponseError } from './errors.ts';
import type { paths } from './generated/schema.d.ts';
import {
  type CustomerLookup,
  customerLookupSchema,
  emailSchema,
  type StudioInformation,
  studioInformationSchema,
} from './schemas.ts';

type CrossStudioSearchBody =
  paths['/v1/cross-studio/customers/search']['post']['requestBody']['content']['application/json'];

export type MagiclineClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
};

export interface MagiclineClient {
  searchCustomersCrossStudio(email: string): Promise<CustomerLookup[]>;
  /** The studio that owns this client's API key. */
  getStudioInformation(): Promise<StudioInformation>;
  getContracts(customerId: number): Promise<MembershipInfo[]>;
  getAccountBalance(customerId: number): Promise<BalanceInfo>;
  getUpcomingTransactions(customerId: number, limit: number): Promise<PaymentInfo[]>;
  /** fromDate/toDate as YYYY-MM-DD (at most 365 days apart). First page only (max 50). */
  getCheckins(
    customerId: number,
    fromDate: string,
    toDate: string,
  ): Promise<{ visits: VisitInfo[]; hasMore: boolean }>;
  /** Needs the cross-studio key; filtered to one studio; daysAhead 0..6 (API maximum). */
  getCrossStudioClassBookings(
    customerId: number,
    studioId: number,
    daysAhead: number,
  ): Promise<ClassBookingInfo[]>;
}

export function createMagiclineClient(opts: MagiclineClientOptions): MagiclineClient {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');

  async function request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const response = await doFetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        'X-API-KEY': opts.apiKey,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
      return request(
        'POST',
        '/v1/cross-studio/customers/search',
        z.array(customerLookupSchema),
        body,
      );
    },

    async getStudioInformation() {
      return request('GET', '/v1/studios/information', studioInformationSchema);
    },

    async getContracts(customerId) {
      return request('GET', `/v1/customers/${id(customerId)}/contracts`, z.array(membershipSchema));
    },

    async getAccountBalance(customerId) {
      return request('GET', `/v1/customers/${id(customerId)}/account/balances`, balanceSchema);
    },

    async getUpcomingTransactions(customerId, limit) {
      return request(
        'GET',
        `/v1/customers/${id(customerId)}/account/transactions/upcoming?sliceSize=${id(limit)}`,
        upcomingPaymentsSchema,
      );
    },

    async getCheckins(customerId, fromDate, toDate) {
      const query = new URLSearchParams({
        fromDate: isoDate(fromDate),
        toDate: isoDate(toDate),
        sliceSize: '50',
      });
      return request(
        'GET',
        `/v1/customers/${id(customerId)}/activities/checkins?${query}`,
        checkinsSchema,
      );
    },

    async getCrossStudioClassBookings(customerId, studioId, daysAhead) {
      if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > 6)
        throw new Error('daysAhead must be 0..6');
      const query = new URLSearchParams({
        studioId: id(studioId),
        daysAhead: id(daysAhead),
        sliceSize: '20',
      });
      return request(
        'GET',
        `/v1/cross-studio/customers/${id(customerId)}/class-bookings?${query}`,
        classBookingsSchema,
      );
    },
  };
}

function parseSeconds(headers: Headers): number | undefined {
  const raw = headers.get('x-ratelimit-reset') ?? headers.get('retry-after');
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Path/query integers only: never interpolate anything else into a Magicline URL. */
function id(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Magicline id');
  return String(value);
}

function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
  return value;
}
