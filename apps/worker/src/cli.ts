import { createServiceClient, createSupabaseFaqRepository } from '@trainmore/db';
import { createFreshdeskClient } from '@trainmore/freshdesk';
import {
  createLogger,
  type Env,
  loadFreshdeskConfig,
  loadRuntimeConfig,
  loadSupabaseConfig,
} from '@trainmore/shared';
import { runFaqSync } from './faq-sync.ts';

export const COMMANDS = ['sync-faq'] as const;
export type Command = (typeof COMMANDS)[number];

export function isCommand(value: unknown): value is Command {
  return COMMANDS.includes(value as Command);
}

/** Runs one worker command; throws on failure so the caller can exit non-zero. */
export async function runCommand(command: Command, env: Env): Promise<void> {
  const runtime = loadRuntimeConfig(env);
  const logger = createLogger({ name: `worker:${command}`, level: runtime.logLevel });
  const repo = createSupabaseFaqRepository(createServiceClient(loadSupabaseConfig(env)));

  switch (command) {
    case 'sync-faq': {
      const freshdesk = loadFreshdeskConfig(env);
      await runFaqSync({
        freshdesk: createFreshdeskClient({ domain: freshdesk.domain, apiKey: freshdesk.apiKey }),
        repo,
        folderIds: freshdesk.faqFolderIds,
        portalUrl: freshdesk.portalUrl,
        logger,
      });
      return;
    }
  }
}
