import { hashEmail } from '@trainmore/core';
import type { RetentionRepository } from '@trainmore/db';
import type { Logger } from '@trainmore/shared';
import { z } from 'zod';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Transcripts are anonymised after 90 days without activity (product owner, 2026-11-12). */
export const TRANSCRIPT_RETENTION_DAYS = 90;
/** Login codes and account bindings are removed after 24 hours. */
export const LOGIN_RETENTION_HOURS = 24;

export type RetentionResult = {
  anonymised: number;
  otpChallengesPurged: number;
  bindingsCleared: number;
};

/** Daily job: anonymise old transcripts (in batches), purge login codes, clear account bindings. */
export async function runRetention(deps: {
  repo: RetentionRepository;
  now: () => Date;
  logger: Logger;
  batchSize?: number;
  /** Upper bound per run; the next run continues where this one stopped. */
  maxBatches?: number;
}): Promise<RetentionResult> {
  const batchSize = deps.batchSize ?? 500;
  const maxBatches = deps.maxBatches ?? 200;
  const now = deps.now().getTime();
  const transcriptsBefore = new Date(now - TRANSCRIPT_RETENTION_DAYS * DAY_MS);
  const loginBefore = new Date(now - (LOGIN_RETENTION_HOURS * DAY_MS) / 24);

  let anonymised = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const done = await deps.repo.anonymiseConversations(transcriptsBefore, batchSize);
    anonymised += done;
    if (done < batchSize) break;
  }
  const otpChallengesPurged = await deps.repo.purgeOtpChallenges(loginBefore);
  const bindingsCleared = await deps.repo.clearAccountBindings(loginBefore);

  const result = { anonymised, otpChallengesPurged, bindingsCleared };
  deps.logger.info(result, 'retention finished');
  return result;
}

/**
 * Deletion request: removes the chatbot data of conversations verified with this email (hashed
 * with the same secret as the login). Logs and returns counts only, never the email or its hash.
 */
export async function runDsarDelete(deps: {
  repo: RetentionRepository;
  email: string;
  secret: string;
  logger: Logger;
}): Promise<{ conversations: number; otpChallenges: number }> {
  const email = z.string().trim().toLowerCase().pipe(z.email()).safeParse(deps.email);
  if (!email.success) throw new Error('dsar-delete needs a valid email address');
  const result = await deps.repo.dsarDelete(hashEmail(deps.secret, email.data));
  deps.logger.info(result, 'deletion request processed');
  return result;
}

/** First line of a stream (the operator types the address; it never appears in a command line). */
export async function readEmailFromStdin(input: AsyncIterable<unknown>): Promise<string> {
  let text = '';
  for await (const chunk of input) {
    text += String(chunk);
    const newline = text.indexOf('\n');
    if (newline >= 0) return text.slice(0, newline).trim();
    if (text.length > 1000) break;
  }
  return text.trim();
}
