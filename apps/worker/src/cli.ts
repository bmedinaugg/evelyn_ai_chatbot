import Anthropic from '@anthropic-ai/sdk';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import {
  createServiceClient,
  createSupabaseEscalationRepository,
  createSupabaseFaqRepository,
  createSupabaseMetricsRepository,
  createSupabaseRetentionRepository,
} from '@trainmore/db';
import { createLocalOutbox, createSesEmailSender } from '@trainmore/email';
import { createFreshdeskClient, createLocalFreshdesk } from '@trainmore/freshdesk';
import {
  createLogger,
  type Env,
  isDay,
  loadClaudeConfig,
  loadEmailConfig,
  loadFreshdeskConfig,
  loadOtpConfig,
  loadReportConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
} from '@trainmore/shared';
import { createReportClusterer, runDailyReport } from './daily-report.ts';
import { runFaqSync } from './faq-sync.ts';
import { FIXTURE_FOLDER_ID, FIXTURE_PORTAL_ID, fixtureFreshdeskClient } from './fixture-source.ts';
import { readEmailFromStdin, runDsarDelete, runRetention } from './retention.ts';
import { runTopicSync } from './topic-sync.ts';

export const COMMANDS = [
  'sync-faq',
  'seed-faq-fixtures',
  'sync-ticket-topics',
  'retention',
  'dsar-delete',
  'daily-report',
] as const;
export type Command = (typeof COMMANDS)[number];

export function isCommand(value: unknown): value is Command {
  return COMMANDS.includes(value as Command);
}

export type CommandOptions = {
  allowMassChange: boolean;
  email?: string;
  day?: string;
  resend?: boolean;
};

/**
 * Parses `<command> [--allow-mass-change]`, `dsar-delete --email <address>` or
 * `daily-report [--day YYYY-MM-DD] [--resend]`; undefined for anything else.
 */
export function parseArgs(argv: string[]): ({ command: Command } & CommandOptions) | undefined {
  const [command, ...flags] = argv;
  if (!isCommand(command)) return undefined;
  if (command === 'dsar-delete') {
    if (flags.length === 0) return { command, allowMassChange: false };
    const [flag, email, ...rest] = flags;
    if (flag !== '--email' || !email || rest.length > 0) return undefined;
    return { command, allowMassChange: false, email };
  }
  if (command === 'daily-report') return parseReportFlags(flags);
  if (flags.some((flag) => flag !== '--allow-mass-change')) return undefined;
  return { command, allowMassChange: flags.includes('--allow-mass-change') };
}

function parseReportFlags(
  flags: string[],
): ({ command: 'daily-report' } & CommandOptions) | undefined {
  let day: string | undefined;
  let resend = false;
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] === '--resend') resend = true;
    else if (flags[i] === '--day' && isDay(flags[i + 1] ?? '')) day = flags[++i];
    else return undefined;
  }
  return { command: 'daily-report', allowMassChange: false, ...(day ? { day } : {}), resend };
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
  // On servers the address is typed in (stdin): a command-line value ends up in AWS records.
  if (command === 'dsar-delete' && options.email !== undefined && runtime.appEnv !== 'local') {
    throw new Error('dsar-delete --email only works with APP_ENV=local; type the address instead');
  }
  // Servers always report on yesterday; other days are for local testing.
  if (command === 'daily-report' && options.day !== undefined && runtime.appEnv !== 'local') {
    throw new Error('daily-report --day only works with APP_ENV=local');
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
      let email = options.email;
      if (email === undefined) {
        process.stderr.write('Email address of the person to delete: ');
        email = await readEmailFromStdin(process.stdin);
      }
      const result = await runDsarDelete({
        repo: createSupabaseRetentionRepository(db),
        email,
        secret: loadOtpConfig(env).secret,
        logger,
      });
      // Counts only, for the operator's record of the request.
      process.stdout.write(
        `Deleted ${result.conversations} conversation(s) and ${result.otpChallenges} login code(s).\n`,
      );
      return;
    }
    case 'daily-report': {
      const report = loadReportConfig(env);
      // Bounded so a run always ends well inside the 15-minute stale-claim window.
      const cluster = createReportClusterer(
        () => new Anthropic({ timeout: 60_000, maxRetries: 1 }).beta.messages,
        loadClaudeConfig(env).fastModel,
      );
      await runDailyReport(
        {
          metrics: createSupabaseMetricsRepository(db),
          cluster,
          email:
            runtime.appEnv === 'local'
              ? createLocalOutbox({ appEnv: runtime.appEnv })
              : createSesEmailSender({
                  client: new SESv2Client({ region: runtime.awsRegion }),
                  ...loadEmailConfig(env),
                }),
          logger,
          now: () => new Date(),
        },
        {
          ...(options.day ? { day: options.day } : {}),
          resend: options.resend ?? false,
          ...report,
        },
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
