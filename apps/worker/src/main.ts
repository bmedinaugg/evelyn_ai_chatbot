import { COMMANDS, parseArgs, runCommand } from './cli.ts';

const args = parseArgs(process.argv.slice(2));
if (!args) {
  process.stderr.write(`Usage: main.ts <${COMMANDS.join('|')}> [--allow-mass-change]\n`);
  process.exit(2);
}

try {
  await runCommand(args.command, process.env, { allowMassChange: args.allowMassChange });
} catch (error) {
  // Errors are already logged by the command; config errors name keys only.
  process.stderr.write(`${error instanceof Error ? error.message : 'worker failed'}\n`);
  process.exit(1);
}
