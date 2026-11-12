import { COMMANDS, parseArgs, runCommand } from './cli.ts';

const args = parseArgs(process.argv.slice(2));
if (!args) {
  process.stderr.write(
    `Usage: main.ts <${COMMANDS.join('|')}> [--allow-mass-change]\n       main.ts dsar-delete            (asks for the email address)\n       main.ts daily-report [--resend] [--day YYYY-MM-DD]   (--day: local only)\n`,
  );
  process.exit(2);
}

try {
  await runCommand(args.command, process.env, args);
} catch (error) {
  // Errors are already logged by the command; config errors name keys only.
  process.stderr.write(`${error instanceof Error ? error.message : 'worker failed'}\n`);
  process.exit(1);
}
