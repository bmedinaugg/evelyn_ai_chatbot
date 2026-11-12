import { DbError, type ServiceClient } from './client.ts';

export interface CapabilityFlagRepository {
  /** Names of tools that are switched off (no row means enabled). */
  disabledCapabilities(): Promise<Set<string>>;
}

export function createSupabaseCapabilityFlagRepository(
  client: ServiceClient,
): CapabilityFlagRepository {
  return {
    async disabledCapabilities() {
      const { data, error } = await client
        .from('capability_flags')
        .select('name')
        .eq('enabled', false);
      if (error) throw new DbError('capability_flags select', error.code);
      return new Set(data.map((row) => row.name));
    },
  };
}
