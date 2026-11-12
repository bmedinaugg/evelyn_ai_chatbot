import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';

export type KeyMap = { crossStudio: string; studios: Record<number, string> };

/** Resolves Magicline API keys: one cross-studio key for lookups, one key per studio for its data. */
export interface MagiclineKeyResolver {
  crossStudioKey(): Promise<string>;
  studioKey(studioId: number): Promise<string>;
}

export class MagiclineKeyNotFoundError extends Error {
  constructor(studioId: number) {
    super(`No Magicline API key configured for studio ${studioId}`);
    this.name = 'MagiclineKeyNotFoundError';
  }
}

/** Parses `cross:<key>,<studioId>:<key>,...` (local/mock configuration). */
export function parseKeyMap(raw: string): KeyMap {
  let crossStudio: string | undefined;
  const studios: Record<number, string> = {};
  for (const entry of raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [scope, key] = entry.split(':');
    if (!scope || !key) throw new Error('Malformed Magicline key entry');
    if (scope === 'cross') crossStudio = key;
    else if (/^\d+$/.test(scope)) studios[Number(scope)] = key;
    else throw new Error('Unknown Magicline key scope');
  }
  if (!crossStudio) throw new Error('Magicline keys need a cross:<key> entry');
  return { crossStudio, studios };
}

function resolverFrom(load: () => Promise<KeyMap>): MagiclineKeyResolver {
  return {
    async crossStudioKey() {
      return (await load()).crossStudio;
    },
    async studioKey(studioId) {
      const key = (await load()).studios[studioId];
      if (!key) throw new MagiclineKeyNotFoundError(studioId);
      return key;
    },
  };
}

export function createStaticKeyResolver(keys: KeyMap): MagiclineKeyResolver {
  return resolverFrom(async () => keys);
}

const secretSchema = z.object({
  crossStudio: z.string().min(1),
  studios: z.record(z.string().regex(/^\d+$/), z.string().min(1)),
});

/**
 * Keys from one JSON secret per environment: {"crossStudio": "...", "studios": {"1001": "..."}}.
 * Cached for ttlMs (default 5 minutes) so a rotated key is picked up without a restart.
 */
export function createSecretsManagerKeyResolver(opts: {
  client: { send(command: GetSecretValueCommand): Promise<{ SecretString?: string | undefined }> };
  secretName: string;
  ttlMs?: number;
  now?: () => number;
}): MagiclineKeyResolver {
  const ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
  const now = opts.now ?? Date.now;
  let cached: { keys: KeyMap; at: number } | undefined;
  return resolverFrom(async () => {
    if (cached && now() - cached.at < ttlMs) return cached.keys;
    const { SecretString } = await opts.client.send(
      new GetSecretValueCommand({ SecretId: opts.secretName }),
    );
    let json: unknown;
    try {
      json = JSON.parse(SecretString ?? '');
    } catch {
      throw new Error('Magicline key secret is not valid JSON');
    }
    const parsed = secretSchema.safeParse(json);
    if (!parsed.success) throw new Error('Magicline key secret has an unexpected shape');
    const keys: KeyMap = {
      crossStudio: parsed.data.crossStudio,
      studios: Object.fromEntries(
        Object.entries(parsed.data.studios).map(([id, key]) => [Number(id), key]),
      ),
    };
    cached = { keys, at: now() };
    return keys;
  });
}
