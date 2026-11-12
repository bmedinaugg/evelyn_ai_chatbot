import type { MagiclineClient } from '@trainmore/magicline';
import { describe, expect, it } from 'vitest';
import {
  availableCapabilities,
  type CapabilityDeps,
  runCapability,
  toolDefinitions,
} from '../src/capabilities/catalogue.ts';

const calls: string[] = [];
const client = (label: string): MagiclineClient =>
  ({
    async getContracts(id: number) {
      calls.push(`${label}:contracts:${id}`);
      return [{ rateName: 'Flex' }];
    },
    async getAccountBalance(id: number) {
      calls.push(`${label}:balance:${id}`);
      return {
        accountBalance: { amount: 0, currency: 'EUR' },
        inDebtCollection: false,
        dunningLevel: null,
      };
    },
    async getUpcomingTransactions(id: number, limit: number) {
      calls.push(`${label}:upcoming:${id}:${limit}`);
      return [];
    },
    async getCheckins(id: number, from: string, to: string) {
      calls.push(`${label}:checkins:${id}:${from}:${to}`);
      // Oldest first on purpose: the tool must sort newest first.
      return {
        visits: Array.from({ length: 8 }, (_, i) => ({
          checkInDateTime: `2026-11-0${i + 1}T08:00:00Z`,
          studioName: 'Club A',
        })),
        hasMore: false,
      };
    },
    async getCrossStudioClassBookings(id: number, studioId: number, days: number) {
      calls.push(`${label}:classes:${id}:${studioId}:${days}`);
      return [];
    },
  }) as unknown as MagiclineClient; // only the account methods are exercised here

const deps: CapabilityDeps = {
  studioClient: async (studioId) => client(`studio${studioId}`),
  crossStudioClient: async () => client('cross'),
  today: () => new Date('2026-11-12T10:00:00Z'),
};
const member = { customerId: 4, studioId: 1001, status: 'MEMBER' as const };
const all = new Set<string>();

describe('capability catalogue', () => {
  it('offers tools by membership status', () => {
    expect(availableCapabilities('MEMBER', all).map((c) => c.name)).toEqual([
      'get_memberships',
      'get_account_balance',
      'get_upcoming_payments',
      'get_recent_visits',
      'get_class_bookings',
    ]);
    expect(availableCapabilities('PROSPECT', all).map((c) => c.name)).toEqual([
      'get_class_bookings',
    ]);
    expect(availableCapabilities('FORMER_MEMBER', all).map((c) => c.name)).toEqual([
      'get_memberships',
      'get_account_balance',
    ]);
  });

  it('leaves out disabled tools', () => {
    expect(
      availableCapabilities('MEMBER', new Set(['get_recent_visits'])).map((c) => c.name),
    ).not.toContain('get_recent_visits');
  });

  it('tool definitions take no input (ids come from the server) and are strict', () => {
    for (const tool of toolDefinitions(availableCapabilities('MEMBER', all))) {
      expect(tool.input_schema).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
      expect(tool.strict).toBe(true);
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('runs a tool for the bound account with the right key', async () => {
    calls.length = 0;
    expect(await runCapability('get_memberships', member, deps, all)).toEqual({
      ok: true,
      data: [{ rateName: 'Flex' }],
    });
    expect(await runCapability('get_class_bookings', member, deps, all)).toMatchObject({
      ok: true,
    });
    expect(calls).toEqual(['studio1001:contracts:4', 'cross:classes:4:1001:6']);
  });

  it('uses Amsterdam dates and lists the newest visits first', async () => {
    calls.length = 0;
    // 00:30 in Amsterdam on 12 November is still 11 November in UTC.
    const lateNight: CapabilityDeps = { ...deps, today: () => new Date('2026-11-11T23:30:00Z') };
    const result = await runCapability('get_recent_visits', member, lateNight, all);
    expect(calls).toEqual(['studio1001:checkins:4:2026-10-13:2026-11-12']);
    const recent = result.ok
      ? (result.data as { recent: { checkInDateTime: string }[] }).recent
      : [];
    expect(recent[0]?.checkInDateTime).toBe('2026-11-08T08:00:00Z');
  });

  it('describes the contract price as a base price, not a monthly one', () => {
    const memberships = availableCapabilities('MEMBER', all).find(
      (c) => c.name === 'get_memberships',
    );
    expect(memberships?.description).not.toMatch(/monthly/i);
  });

  it('summarises visits over the last 30 days', async () => {
    calls.length = 0;
    const result = await runCapability('get_recent_visits', member, deps, all);
    expect(calls).toEqual(['studio1001:checkins:4:2026-10-13:2026-11-12']);
    expect(result).toMatchObject({ ok: true, data: { periodDays: 30, count: 8 } });
    expect(result.ok && (result.data as { recent: unknown[] }).recent).toHaveLength(5);
  });

  it('refuses unknown, disabled or not-allowed tools, and hides Magicline errors', async () => {
    expect(await runCapability('delete_everything', member, deps, all)).toEqual({ ok: false });
    expect(
      await runCapability('get_memberships', member, deps, new Set(['get_memberships'])),
    ).toEqual({ ok: false });
    expect(
      await runCapability('get_upcoming_payments', { ...member, status: 'PROSPECT' }, deps, all),
    ).toEqual({ ok: false });
    const failing: CapabilityDeps = {
      ...deps,
      studioClient: async () => {
        throw new Error('Magicline 503 for a@example.com');
      },
    };
    expect(await runCapability('get_memberships', member, failing, all)).toEqual({ ok: false });
  });
});
