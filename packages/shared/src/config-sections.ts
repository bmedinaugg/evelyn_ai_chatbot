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

export type ClaudeConfig = { chatModel: string };
export type ApiConfig = {
  port: number;
  trustProxyHops: number;
  allowedOrigins: string[];
  supportContactUrl: string;
};
export type TurnstileConfig = { secretKey: string };

export function loadClaudeConfig(env: Env = process.env): ClaudeConfig {
  const e = parseEnv(
    z.object({
      CLAUDE_CHAT_MODEL: z
        .string()
        .default('claude-sonnet-5-5')
        .refine((model) => /^claude-[a-z0-9-]+$/.test(model), {
          message: 'must be a Claude model id such as claude-sonnet-5-5',
        }),
    }),
    env,
  );
  return { chatModel: e.CLAUDE_CHAT_MODEL };
}

const HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function loadApiConfig(env: Env = process.env): ApiConfig {
  const e = parseEnv(
    z
      .object({
        APP_ENV: runtimeEnvShape.APP_ENV,
        API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
        // Proxies in front of the API: CloudFront + ALB = 2; 0 when exposed directly (local).
        TRUST_PROXY_HOPS: z
          .string()
          .regex(/^[0-5]$/)
          .default('0')
          .transform(Number),
        WIDGET_ALLOWED_ORIGINS: z.string().transform((raw) =>
          raw
            .split(',')
            .map((origin) => origin.trim().toLowerCase())
            .filter(Boolean),
        ),
        SUPPORT_CONTACT_URL: z.url({ protocol: /^https$/ }),
      })
      .superRefine((cfg, ctx) => {
        const valid = cfg.WIDGET_ALLOWED_ORIGINS.every(
          (origin) =>
            HTTPS_ORIGIN.test(origin) || (cfg.APP_ENV === 'local' && LOCAL_ORIGIN.test(origin)),
        );
        if (cfg.WIDGET_ALLOWED_ORIGINS.length === 0 || !valid) {
          ctx.addIssue({
            code: 'custom',
            path: ['WIDGET_ALLOWED_ORIGINS'],
            message:
              'must be a comma-separated list of https origins (no path); http://localhost only with APP_ENV=local',
          });
        }
      }),
    env,
  );
  return {
    port: e.API_PORT,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    allowedOrigins: e.WIDGET_ALLOWED_ORIGINS,
    supportContactUrl: e.SUPPORT_CONTACT_URL,
  };
}

export function loadTurnstileConfig(env: Env = process.env): TurnstileConfig {
  const e = parseEnv(z.object({ TURNSTILE_SECRET_KEY: z.string().min(1) }), env);
  return { secretKey: e.TURNSTILE_SECRET_KEY };
}
