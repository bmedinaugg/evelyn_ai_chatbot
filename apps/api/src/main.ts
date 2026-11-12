import Anthropic from '@anthropic-ai/sdk';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { createClaudeAnswerer } from '@trainmore/core';
import {
  createServiceClient,
  createSupabaseAuthRepository,
  createSupabaseCapabilityFlagRepository,
  createSupabaseConversationRepository,
  createSupabaseEscalationRepository,
  createSupabaseFaqRepository,
  createSupabasePortalRepository,
  createSupabaseScenarioRepository,
} from '@trainmore/db';
import { createLocalOutbox, createSesEmailSender } from '@trainmore/email';
import { createFreshdeskClient, createLocalFreshdesk } from '@trainmore/freshdesk';
import {
  createMagiclineClient,
  createSecretsManagerKeyResolver,
  createStaticKeyResolver,
  parseKeyMap,
} from '@trainmore/magicline';
import {
  createLogger,
  loadApiConfig,
  loadClaudeConfig,
  loadConfig,
  loadEmailConfig,
  loadFreshdeskConfig,
  loadMagiclineKeysConfig,
  loadOtpConfig,
  loadPortalConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
  loadTurnstileConfig,
} from '@trainmore/shared';
import { createFakeAnswerer } from './fake-answerer.ts';
import { createMagiclineAccess } from './magicline-access.ts';
import { createEntraClient } from './portal/entra.ts';
import { buildApiServer } from './server.ts';
import { createTurnstileVerifier } from './turnstile.ts';

const env = process.env;
const runtime = loadRuntimeConfig(env);
const api = loadApiConfig(env);
const logger = createLogger({ name: 'api', level: runtime.logLevel });
const db = createServiceClient(loadSupabaseConfig(env));
// FRESHDESK_FAKE=1 prints tickets locally instead of sending them (refuses outside APP_ENV=local).
const freshdeskClient =
  env.FRESHDESK_FAKE === '1'
    ? createLocalFreshdesk({ appEnv: runtime.appEnv })
    : (() => {
        const freshdesk = loadFreshdeskConfig(env);
        return createFreshdeskClient({ domain: freshdesk.domain, apiKey: freshdesk.apiKey });
      })();
if (env.FRESHDESK_FAKE === '1') logger.warn('using the local Freshdesk stand-in (no real tickets)');

const useFake = runtime.appEnv === 'local' && env.CHAT_FAKE_ANSWERER === '1';
const answerer = useFake
  ? createFakeAnswerer()
  : createClaudeAnswerer({
      // Bounded so a turn finishes well before its 60 s claim can be taken over (at most ~2 x 25 s).
      client: new Anthropic({ timeout: 25_000, maxRetries: 1 }).beta.messages,
      model: loadClaudeConfig(env).chatModel,
    });
if (useFake) logger.warn('using the fake answerer (local smoke tests only)');

// Login: codes by email (SES; printed locally), Magicline keys from Secrets Manager (env with the mock).
const magiclineKeys = loadMagiclineKeysConfig(env);
const keys =
  magiclineKeys.kind === 'env'
    ? createStaticKeyResolver(parseKeyMap(magiclineKeys.raw))
    : createSecretsManagerKeyResolver({
        client: new SecretsManagerClient({ region: runtime.awsRegion }),
        secretName: magiclineKeys.secretName,
      });
const emailSender =
  runtime.appEnv === 'local'
    ? createLocalOutbox({ appEnv: runtime.appEnv })
    : createSesEmailSender({
        client: new SESv2Client({ region: runtime.awsRegion }),
        ...loadEmailConfig(env),
      });
const login = {
  auth: createSupabaseAuthRepository(db),
  email: emailSender,
  magicline: createMagiclineAccess({ baseUrl: loadConfig(env).magicline.baseUrl, keys }),
  config: loadOtpConfig(env),
  logger,
};

// Account tools: per-club key for the customer's own data, cross-studio key for class bookings.
const magiclineBaseUrl = loadConfig(env).magicline.baseUrl;
const flags = createSupabaseCapabilityFlagRepository(db);
const capabilities = {
  deps: {
    studioClient: async (studioId: number) =>
      createMagiclineClient({ baseUrl: magiclineBaseUrl, apiKey: await keys.studioKey(studioId) }),
    crossStudioClient: async () =>
      createMagiclineClient({ baseUrl: magiclineBaseUrl, apiKey: await keys.crossStudioKey() }),
    today: () => new Date(),
  },
  disabled: () => flags.disabledCapabilities(),
};

// Agent portal: only when Entra is configured (docs/DEPLOY.md, "Entra app registration").
const portalConfig = loadPortalConfig(env);
if (!portalConfig) logger.info('agent portal off (no Entra configuration)');

const app = buildApiServer({
  ...(portalConfig
    ? {
        portal: {
          config: portalConfig,
          entra: createEntraClient(portalConfig),
          repo: createSupabasePortalRepository(db),
        },
      }
    : {}),
  login,
  capabilities,
  conversations: createSupabaseConversationRepository(db),
  faq: createSupabaseFaqRepository(db),
  scenarios: createSupabaseScenarioRepository(db),
  escalations: createSupabaseEscalationRepository(db),
  answerer,
  freshdesk: freshdeskClient,
  verifyTurnstile: createTurnstileVerifier({ secretKey: loadTurnstileConfig(env).secretKey }),
  config: {
    allowedOrigins: api.allowedOrigins,
    supportContactUrl: api.supportContactUrl,
    trustProxyHops: api.trustProxyHops,
    // Non-production tickets are tagged so support can route them to a test group.
    ...(runtime.appEnv === 'prod' ? {} : { envTag: `chatbot-${runtime.appEnv}` }),
  },
  logger,
});

await app.listen({ port: api.port, host: '0.0.0.0' });
