import { COMMANDS, isCommand, runCommand } from './cli.ts';

const command = process.argv[2];
if (!isCommand(command)) {
  process.stderr.write(`Usage: main.ts <${COMMANDS.join('|')}>\n`);
  process.exit(2);
}

try {
  await runCommand(command, process.env);
} catch (error) {
  // Errors are already logged by the command; config errors name keys only.
  process.stderr.write(`${error instanceof Error ? error.message : 'worker failed'}\n`);
  process.exit(1);
}
