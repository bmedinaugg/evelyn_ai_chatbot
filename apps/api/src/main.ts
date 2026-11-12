import Anthropic from '@anthropic-ai/sdk';
import { createClaudeAnswerer } from '@trainmore/core';
import {
  createServiceClient,
  createSupabaseConversationRepository,
  createSupabaseFaqRepository,
} from '@trainmore/db';
import { createFreshdeskClient } from '@trainmore/freshdesk';
import {
  createLogger,
  loadApiConfig,
  loadClaudeConfig,
  loadFreshdeskConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
  loadTurnstileConfig,
} from '@trainmore/shared';
import { createFakeAnswerer } from './fake-answerer.ts';
import { buildApiServer } from './server.ts';
import { createTurnstileVerifier } from './turnstile.ts';

const env = process.env;
const runtime = loadRuntimeConfig(env);
const api = loadApiConfig(env);
const logger = createLogger({ name: 'api', level: runtime.logLevel });
const db = createServiceClient(loadSupabaseConfig(env));
const freshdesk = loadFreshdeskConfig(env);

const useFake = runtime.appEnv === 'local' && env.CHAT_FAKE_ANSWERER === '1';
const answerer = useFake
  ? createFakeAnswerer()
  : createClaudeAnswerer({
      client: new Anthropic().beta.messages,
      model: loadClaudeConfig(env).chatModel,
    });
if (useFake) logger.warn('using the fake answerer (local smoke tests only)');

const app = buildApiServer({
  conversations: createSupabaseConversationRepository(db),
  faq: createSupabaseFaqRepository(db),
  answerer,
  freshdesk: createFreshdeskClient({ domain: freshdesk.domain, apiKey: freshdesk.apiKey }),
  verifyTurnstile: createTurnstileVerifier({ secretKey: loadTurnstileConfig(env).secretKey }),
  config: { allowedOrigins: api.allowedOrigins, supportContactUrl: api.supportContactUrl },
  logger,
});

await app.listen({ port: api.port, host: '0.0.0.0' });
