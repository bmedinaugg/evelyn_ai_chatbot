import { randomBytes } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  createServiceClient,
  createSupabaseAuthRepository,
  createSupabaseCapabilityFlagRepository,
  createSupabaseConversationRepository,
  createSupabaseFaqRepository,
} from '@trainmore/db';
import { createMagiclineClient, createStaticKeyResolver, parseKeyMap } from '@trainmore/magicline';
import {
  createLogger,
  loadClaudeConfig,
  loadConfig,
  loadMagiclineKeysConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
} from '@trainmore/shared';
import { CASES } from './cases.ts';
import { estimateUsd, runEvals } from './run-evals.ts';
import { isLocalMagicline } from './safety.ts';

const PASS_RATE_REQUIRED = 0.9;

const env = process.env;
const runtime = loadRuntimeConfig(env);
if (env.EVAL_CONFIRM_SPEND !== 'yes' || runtime.appEnv !== 'local') {
  process.stderr.write(
    'Evals call the real Claude API. Run with APP_ENV=local and EVAL_CONFIRM_SPEND=yes.\n',
  );
  process.exit(2);
}

const db = createServiceClient(loadSupabaseConfig(env));
const logger = createLogger({ name: 'evals', level: 'warn' });

// Logged-in cases use the mock Magicline server (synthetic profiles) — never real customer data.
const magiclineConfig = loadConfig(env).magicline;
const keysConfig = loadMagiclineKeysConfig(env);
if (
  !magiclineConfig.useMock ||
  keysConfig.kind !== 'env' ||
  !isLocalMagicline(magiclineConfig.baseUrl)
) {
  process.stderr.write(
    'Evals only run against the local mock Magicline server (MAGICLINE_USE_MOCK=true, localhost URL).\n',
  );
  process.exit(2);
}
const keys = createStaticKeyResolver(parseKeyMap(keysConfig.raw));
const magicline = (apiKey: string) =>
  createMagiclineClient({ baseUrl: magiclineConfig.baseUrl, apiKey });
const flags = createSupabaseCapabilityFlagRepository(db);
const model = loadClaudeConfig(env).chatModel;
const results = await runEvals(
  {
    faq: createSupabaseFaqRepository(db),
    conversations: createSupabaseConversationRepository(db),
    client: new Anthropic().beta.messages,
    model,
    logger,
    login: {
      auth: createSupabaseAuthRepository(db),
      magicline: {
        searchByEmail: async (email) =>
          magicline(await keys.crossStudioKey()).searchCustomersCrossStudio(email),
        studioName: async (studioId) =>
          (await magicline(await keys.studioKey(studioId)).getStudioInformation()).name,
      },
      // A fresh secret per run: eval logins never share hashes with the app.
      config: {
        secret: randomBytes(32).toString('hex'),
        ttlSeconds: 300,
        maxAttempts: 5,
        maxPerWindow: 3,
        windowSeconds: 900,
      },
      logger,
    },
    capabilities: {
      deps: {
        studioClient: async (studioId) => magicline(await keys.studioKey(studioId)),
        crossStudioClient: async () => magicline(await keys.crossStudioKey()),
        today: () => new Date(),
      },
      disabled: () => flags.disabledCapabilities(),
    },
  },
  CASES,
);

const rows = results.map((r) => ({
  case: r.id,
  result: r.failures.length === 0 ? 'PASS' : 'FAIL',
  outcome: r.reply.outcome,
  cited: r.reply.citations.map((c) => c.articleId).join(' '),
  lang: r.reply.lang,
  'in/out/cache': `${r.usage.input}/${r.usage.output}/${r.usage.cacheRead}`,
}));
console.table(rows);
for (const r of results.filter((x) => x.failures.length > 0)) {
  console.log(`\n✗ ${r.id}\n  ${r.failures.join('\n  ')}\n  reply: ${r.reply.text}`);
}
const passed = results.filter((r) => r.failures.length === 0).length;
const totalUsd = results.reduce((sum, r) => sum + estimateUsd(r.usage), 0);
console.log(
  `\nModel ${model}: ${passed}/${results.length} passed; estimated cost $${totalUsd.toFixed(3)}`,
);
process.exit(passed / results.length >= PASS_RATE_REQUIRED ? 0 : 1);
