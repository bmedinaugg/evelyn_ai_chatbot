import Anthropic from '@anthropic-ai/sdk';
import { clusterQuestions, judgeReplay } from '@trainmore/core';
import { loadClaudeConfig, loadRuntimeConfig } from '@trainmore/shared';
import { CLUSTER_CASES, checkClusters, checkVerdict, JUDGE_CASES } from './fast-model-cases.ts';

// Fast-model prompts (M5): daily report grouping and the replay judge, on synthetic text only.
const env = process.env;
if (env.EVAL_CONFIRM_SPEND !== 'yes' || loadRuntimeConfig(env).appEnv !== 'local') {
  process.stderr.write(
    'Evals call the real Claude API. Run with APP_ENV=local and EVAL_CONFIRM_SPEND=yes.\n',
  );
  process.exit(2);
}
const claude = { client: new Anthropic().beta.messages, model: loadClaudeConfig(env).fastModel };

const results: { case: string; result: string; detail: string }[] = [];
for (const c of CLUSTER_CASES) {
  const failures = checkClusters(c, await clusterQuestions(claude, c.questions));
  results.push({
    case: c.id,
    result: failures.length ? 'FAIL' : 'PASS',
    detail: failures.join('; '),
  });
}
for (const c of JUDGE_CASES) {
  const verdicts = await judgeReplay(claude, {
    items: [c.item],
    draftAnswer: c.draftAnswer,
    lang: c.lang,
  });
  const failures = checkVerdict(c, verdicts);
  results.push({
    case: c.id,
    result: failures.length ? 'FAIL' : 'PASS',
    detail: failures.join('; ') || (verdicts?.[0]?.reason ?? ''),
  });
}
console.table(results);
const passed = results.filter((r) => r.result === 'PASS').length;
console.log(`\nModel ${claude.model}: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
