import type { LoginDeps } from '@trainmore/core';
import { createMagiclineClient, type MagiclineKeyResolver } from '@trainmore/magicline';

/** Magicline as the login flow needs it: cross-studio search, and studio names (cached per process). */
export function createMagiclineAccess(opts: {
  baseUrl: string;
  keys: MagiclineKeyResolver;
  fetch?: typeof fetch;
}): LoginDeps['magicline'] {
  const names = new Map<number, string>();
  const client = (apiKey: string) =>
    createMagiclineClient({
      baseUrl: opts.baseUrl,
      apiKey,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  return {
    async searchByEmail(email) {
      return client(await opts.keys.crossStudioKey()).searchCustomersCrossStudio(email);
    },
    async studioName(studioId) {
      const cached = names.get(studioId);
      if (cached) return cached;
      const { name } = await client(await opts.keys.studioKey(studioId)).getStudioInformation();
      names.set(studioId, name);
      return name;
    },
  };
}
