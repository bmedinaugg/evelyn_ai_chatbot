import {
  createServiceClient,
  createSupabaseEscalationRepository,
  createSupabaseFaqRepository,
} from '@trainmore/db';
import { createFreshdeskClient } from '@trainmore/freshdesk';
import {
  createLogger,
  type Env,
  loadFreshdeskConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
} from '@trainmore/shared';
import { runFaqSync } from './faq-sync.ts';
import { FIXTURE_FOLDER_ID, fixtureFreshdeskClient } from './fixture-source.ts';
import { runTopicSync } from './topic-sync.ts';

export const COMMANDS = ['sync-faq', 'seed-faq-fixtures', 'sync-ticket-topics'] as const;
export type Command = (typeof COMMANDS)[number];

export function isCommand(value: unknown): value is Command {
  return COMMANDS.includes(value as Command);
}

export type CommandOptions = { allowMassChange: boolean };

/** Parses `<command> [--allow-mass-change]`; undefined for anything else. */
export function parseArgs(argv: string[]): ({ command: Command } & CommandOptions) | undefined {
  const [command, ...flags] = argv;
  if (!isCommand(command)) return undefined;
  if (flags.some((flag) => flag !== '--allow-mass-change')) return undefined;
  return { command, allowMassChange: flags.includes('--allow-mass-change') };
}

/** Runs one worker command; throws on failure so the caller can exit non-zero. */
export async function runCommand(
  command: Command,
  env: Env,
  options: CommandOptions = { allowMassChange: false },
): Promise<void> {
  const runtime = loadRuntimeConfig(env);
  if (command === 'seed-faq-fixtures' && runtime.appEnv !== 'local') {
    throw new Error('seed-faq-fixtures only runs with APP_ENV=local');
  }
  const logger = createLogger({ name: `worker:${command}`, level: runtime.logLevel });
  const db = createServiceClient(loadSupabaseConfig(env));
  const repo = createSupabaseFaqRepository(db);

  switch (command) {
    case 'sync-faq': {
      const freshdesk = loadFreshdeskConfig(env);
      await runFaqSync({
        freshdesk: createFreshdeskClient({ domain: freshdesk.domain, apiKey: freshdesk.apiKey }),
        repo,
        folderIds: freshdesk.faqFolderIds,
        portalUrl: freshdesk.portalUrl,
        logger,
        allowMassChange: options.allowMassChange,
      });
      return;
    }
    case 'seed-faq-fixtures': {
      await runFaqSync({
        freshdesk: fixtureFreshdeskClient(),
        repo,
        folderIds: [FIXTURE_FOLDER_ID],
        portalUrl: 'https://portal.example',
        logger,
      });
      return;
    }
    case 'sync-ticket-topics': {
      const freshdesk = loadFreshdeskConfig(env);
      await runTopicSync({
        freshdesk: createFreshdeskClient({ domain: freshdesk.domain, apiKey: freshdesk.apiKey }),
        repo: createSupabaseEscalationRepository(db),
        field: freshdesk.topicField,
        logger,
      });
      return;
    }
  }
}
