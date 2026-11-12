import Anthropic from '@anthropic-ai/sdk';
import {
  createServiceClient,
  createSupabaseConversationRepository,
  createSupabaseFaqRepository,
} from '@trainmore/db';
import {
  createLogger,
  loadClaudeConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
} from '@trainmore/shared';
import { CASES } from './cases.ts';
import { estimateUsd, runEvals } from './run-evals.ts';

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
const model = loadClaudeConfig(env).chatModel;
const results = await runEvals(
  {
    faq: createSupabaseFaqRepository(db),
    conversations: createSupabaseConversationRepository(db),
    client: new Anthropic().beta.messages,
    model,
    logger: createLogger({ name: 'evals', level: 'warn' }),
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
