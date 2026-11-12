import { z } from 'zod';
import { type Config, type Env, parseEnv, runtimeEnvShape } from './config.ts';

export type RuntimeConfig = Pick<Config, 'nodeEnv' | 'appEnv' | 'awsRegion' | 'logLevel'>;
export type SupabaseConfig = { url: string; serviceRoleKey: string };
export type FreshdeskConfig = {
  domain: string;
  apiKey: string;
  faqFolderIds: number[];
  portalUrl: string;
};

export function loadRuntimeConfig(env: Env = process.env): RuntimeConfig {
  const e = parseEnv(z.object(runtimeEnvShape), env);
  return { nodeEnv: e.NODE_ENV, appEnv: e.APP_ENV, awsRegion: e.AWS_REGION, logLevel: e.LOG_LEVEL };
}

export function loadSupabaseConfig(env: Env = process.env): SupabaseConfig {
  const e = parseEnv(
    z.object({ SUPABASE_URL: z.url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) }),
    env,
  );
  return { url: e.SUPABASE_URL, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY };
}

const folderIds = z
  .string()
  .transform((raw) => raw.split(',').map((part) => part.trim()))
  .refine((parts) => parts.length > 0 && parts.every((part) => /^[1-9]\d*$/.test(part)), {
    message: 'must be a comma-separated list of positive integers',
  })
  .transform((parts) => parts.map(Number));

export function loadFreshdeskConfig(env: Env = process.env): FreshdeskConfig {
  const e = parseEnv(
    z.object({
      FRESHDESK_DOMAIN: z
        .string()
        .trim()
        .toLowerCase()
        .refine((domain) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain), {
          message: 'must be a bare host name like yourcompany.freshdesk.com',
        }),
      FRESHDESK_API_KEY: z.string().min(1),
      FRESHDESK_FAQ_FOLDER_IDS: folderIds,
      FRESHDESK_PORTAL_URL: z
        .url({ protocol: /^https?$/ })
        .transform((url) => url.replace(/\/+$/, '')),
    }),
    env,
  );
  return {
    domain: e.FRESHDESK_DOMAIN,
    apiKey: e.FRESHDESK_API_KEY,
    faqFolderIds: e.FRESHDESK_FAQ_FOLDER_IDS,
    portalUrl: e.FRESHDESK_PORTAL_URL,
  };
}
