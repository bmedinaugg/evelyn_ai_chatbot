import type Anthropic from '@anthropic-ai/sdk';
import type { CustomerStatus } from '@trainmore/db';
import type { MagiclineClient } from '@trainmore/magicline';

/** The account bound to the conversation (server-side); tools never take ids from the model. */
export type AccountContext = { customerId: number; studioId: number; status: CustomerStatus };

export type CapabilityDeps = {
  studioClient(studioId: number): Promise<MagiclineClient>;
  crossStudioClient(): Promise<MagiclineClient>;
  today(): Date;
};

export type Capability = {
  name: string;
  /** Shown to Claude: what the tool returns and when to use it. */
  description: string;
  statuses: readonly CustomerStatus[];
  run(account: AccountContext, deps: CapabilityDeps): Promise<unknown>;
};

const MAX_ITEMS = 20;
const VISIT_DAYS = 30;

/** Calendar date in the clubs' timezone (YYYY-MM-DD). */
const amsterdamDay = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const CLASS_DAYS_AHEAD = 6; // API maximum

/** Read-only capabilities (docs/superpowers/plans/2026-11-12-m2b-account-answers.md). Order = tool order. */
export const CAPABILITIES: readonly Capability[] = [
  {
    name: 'get_memberships',
    description:
      "The customer's membership contracts: plan name, start and end date, status, cancellation status and dates, notice period, term and base price of the contract (not necessarily per month).",
    statuses: ['MEMBER', 'FORMER_MEMBER'],
    run: async (a, d) =>
      (await (await d.studioClient(a.studioId)).getContracts(a.customerId)).slice(0, MAX_ITEMS),
  },
  {
    name: 'get_account_balance',
    description:
      "The customer's current account balance (negative = amount owed), whether a debt collection agency is involved, and the reminder (dunning) level.",
    statuses: ['MEMBER', 'FORMER_MEMBER'],
    run: async (a, d) => (await d.studioClient(a.studioId)).getAccountBalance(a.customerId),
  },
  {
    name: 'get_upcoming_payments',
    description:
      "The customer's next scheduled payments (due date, description, amount, open amount).",
    statuses: ['MEMBER'],
    run: async (a, d) =>
      (await d.studioClient(a.studioId)).getUpcomingTransactions(a.customerId, 6),
  },
  {
    name: 'get_recent_visits',
    description: `How often the customer checked in during the last ${VISIT_DAYS} days, with the most recent visits (date/time and club).`,
    statuses: ['MEMBER'],
    run: async (a, d) => {
      const to = d.today();
      const from = new Date(to.getTime() - VISIT_DAYS * 24 * 60 * 60 * 1000);
      const { visits, hasMore } = await (await d.studioClient(a.studioId)).getCheckins(
        a.customerId,
        amsterdamDay(from),
        amsterdamDay(to),
      );
      const newestFirst = [...visits].sort((x, y) =>
        (y.checkInDateTime ?? '').localeCompare(x.checkInDateTime ?? ''),
      );
      // The API returns at most 50 per page; more than that is reported as "at least".
      return {
        periodDays: VISIT_DAYS,
        count: hasMore ? `${visits.length}+` : visits.length,
        recent: newestFirst.slice(0, 5),
      };
    },
  },
  {
    name: 'get_class_bookings',
    description:
      "The customer's class bookings for the next 14 days (class, start and end time, club, booking status).",
    statuses: ['MEMBER', 'PROSPECT'],
    run: async (a, d) =>
      (
        await (
          await d.crossStudioClient()
        ).getCrossStudioClassBookings(a.customerId, a.studioId, CLASS_DAYS_AHEAD)
      ).slice(0, MAX_ITEMS),
  },
];

export function availableCapabilities(
  status: CustomerStatus,
  disabled: ReadonlySet<string>,
): Capability[] {
  return CAPABILITIES.filter((c) => c.statuses.includes(status) && !disabled.has(c.name));
}

export function toolDefinitions(capabilities: readonly Capability[]): Anthropic.Beta.BetaTool[] {
  return capabilities.map((c) => ({
    name: c.name,
    description: c.description,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  }));
}

/**
 * Runs a tool for the bound account. Re-checks name, status and flags server-side (whatever the
 * model asked for); any failure is reported as unavailable without details.
 */
export async function runCapability(
  name: string,
  account: AccountContext,
  deps: CapabilityDeps,
  disabled: ReadonlySet<string>,
): Promise<{ ok: true; data: unknown } | { ok: false }> {
  const capability = availableCapabilities(account.status, disabled).find((c) => c.name === name);
  if (!capability) return { ok: false };
  try {
    return { ok: true, data: await capability.run(account, deps) };
  } catch {
    return { ok: false };
  }
}
