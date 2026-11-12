import Anthropic from '@anthropic-ai/sdk';
import { type CreateClient, clusterQuestions, judgeReplay } from '@trainmore/core';
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
// Records usage and stop reasons per call, to report the real cost and cut-off answers.
const messages = new Anthropic().beta.messages;
const usage = { input: 0, output: 0, calls: 0, stops: [] as string[] };
const client: CreateClient = {
  create: (async (...args: Parameters<CreateClient['create']>) => {
    const response = await messages.create(...args);
    if ('usage' in response) {
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.calls += 1;
      usage.stops.push(String(response.stop_reason));
    }
    return response;
  }) as CreateClient['create'],
};
const claude = { client, model: loadClaudeConfig(env).fastModel };

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
// Haiku 5.5 list price (prompts ≤ 100K tokens): $0.10 / $0.50 per million input / output tokens.
const usd = (usage.input * 0.1 + usage.output * 0.5) / 1_000_000;
console.log(
  `Usage: ${usage.calls} calls, ${usage.input} input / ${usage.output} output tokens, about $${usd.toFixed(4)}; stop reasons: ${usage.stops.join(', ')}`,
);
process.exit(passed === results.length ? 0 : 1);
