import {
  createServiceClient,
  createSupabaseEscalationRepository,
  createSupabaseFaqRepository,
  createSupabaseRetentionRepository,
} from '@trainmore/db';
import { createFreshdeskClient, createLocalFreshdesk } from '@trainmore/freshdesk';
import {
  createLogger,
  type Env,
  loadFreshdeskConfig,
  loadOtpConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
} from '@trainmore/shared';
import { runFaqSync } from './faq-sync.ts';
import { FIXTURE_FOLDER_ID, FIXTURE_PORTAL_ID, fixtureFreshdeskClient } from './fixture-source.ts';
import { runDsarDelete, runRetention } from './retention.ts';
import { runTopicSync } from './topic-sync.ts';

export const COMMANDS = [
  'sync-faq',
  'seed-faq-fixtures',
  'sync-ticket-topics',
  'retention',
  'dsar-delete',
] as const;
export type Command = (typeof COMMANDS)[number];

export function isCommand(value: unknown): value is Command {
  return COMMANDS.includes(value as Command);
}

export type CommandOptions = { allowMassChange: boolean; email?: string };

/**
 * Parses `<command> [--allow-mass-change]` or `dsar-delete --email <address>`; undefined for
 * anything else.
 */
export function parseArgs(argv: string[]): ({ command: Command } & CommandOptions) | undefined {
  const [command, ...flags] = argv;
  if (!isCommand(command)) return undefined;
  if (command === 'dsar-delete') {
    const [flag, email, ...rest] = flags;
    if (flag !== '--email' || !email || rest.length > 0) return undefined;
    return { command, allowMassChange: false, email };
  }
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
        portalId: freshdesk.portalId,
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
        portalId: FIXTURE_PORTAL_ID,
        logger,
      });
      return;
    }
    case 'retention': {
      await runRetention({
        repo: createSupabaseRetentionRepository(db),
        now: () => new Date(),
        logger,
      });
      return;
    }
    case 'dsar-delete': {
      if (!options.email) throw new Error('dsar-delete needs --email');
      const result = await runDsarDelete({
        repo: createSupabaseRetentionRepository(db),
        email: options.email,
        secret: loadOtpConfig(env).secret,
        logger,
      });
      // Counts only, for the operator's record of the request.
      process.stdout.write(
        `Deleted ${result.conversations} conversation(s) and ${result.otpChallenges} login code(s).\n`,
      );
      return;
    }
    case 'sync-ticket-topics': {
      if (env.FRESHDESK_FAKE === '1') {
        await runTopicSync({
          freshdesk: createLocalFreshdesk({ appEnv: runtime.appEnv }),
          repo: createSupabaseEscalationRepository(db),
          field: 'ticket_type',
          logger,
        });
        return;
      }
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
