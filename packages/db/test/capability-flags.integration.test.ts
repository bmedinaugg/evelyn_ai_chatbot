import { afterAll, describe, expect, it } from 'vitest';
import { createServiceClient, createSupabaseCapabilityFlagRepository } from '../src/index.ts';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey)
  throw new Error('Supabase env missing: run via `pnpm --filter @trainmore/db test:integration`');
const client = createServiceClient({ url, serviceRoleKey });
const flags = createSupabaseCapabilityFlagRepository(client);

afterAll(async () => {
  await client.from('capability_flags').delete().in('name', ['test_tool_a', 'test_tool_b']);
});

describe('capability flags', () => {
  it('lists only switched-off tools', async () => {
    await client.from('capability_flags').upsert([
      { name: 'test_tool_a', enabled: false },
      { name: 'test_tool_b', enabled: true },
    ]);
    const disabled = await flags.disabledCapabilities();
    expect(disabled.has('test_tool_a')).toBe(true);
    expect(disabled.has('test_tool_b')).toBe(false);
  });
});
