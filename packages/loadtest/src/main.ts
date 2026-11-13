import { setTimeout as sleep } from 'node:timers/promises';
import { parseConfig, USAGE } from './config.ts';
import { formatReport } from './report.ts';
import { runLoadTest, seededRandom } from './run.ts';

// Load test for the widget chat API (docs/TESTING.md, "Load test"). Local by default; a remote
// target needs LOADTEST_CONFIRM_TARGET=<host>, because every answered question is a paid call.
const result = parseConfig(process.argv.slice(2), process.env);
if (result.ok === 'help') {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
if (!result.ok) {
  process.stderr.write(`${result.error}\n\n${USAGE}\n`);
  process.exit(2);
}
const { config } = result;

if (!config.json) {
  const plan =
    config.mode.kind === 'duration'
      ? `for ${config.mode.durationMs / 1000} s`
      : `${config.mode.perVisitor} conversation(s) each`;
  process.stderr.write(
    `Starting ${config.visitors} visitors against ${config.baseUrl}, ${plan}, ` +
      `${config.minQuestions}-${config.maxQuestions} questions per conversation…\n`,
  );
}

const summary = await runLoadTest(config, {
  fetch: globalThis.fetch.bind(globalThis),
  now: () => performance.now(),
  sleep: (ms) => (ms > 0 ? sleep(ms) : Promise.resolve()),
  randomFor: (index) => (config.seed === null ? Math.random : seededRandom(config.seed + index)),
});

process.stdout.write(
  config.json
    ? `${JSON.stringify({ target: config.baseUrl, visitors: config.visitors, ...summary }, null, 2)}\n`
    : `${formatReport(summary, config)}\n`,
);
