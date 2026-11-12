import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { AccountCandidate, AuthRepository, CustomerStatus } from '@trainmore/db';
import type { EmailSender } from '@trainmore/email';
import type { Lang } from '@trainmore/i18n';
import type { CustomerLookup } from '@trainmore/magicline';
import type { Logger } from '@trainmore/shared';
import { z } from 'zod';

export type OtpConfig = {
  /** Server-side pepper for email and code hashes (≥ 32 characters). */
  secret: string;
  ttlSeconds: number;
  maxAttempts: number;
  maxPerWindow: number;
  windowSeconds: number;
};

export type LoginDeps = {
  auth: AuthRepository;
  email: EmailSender;
  magicline: {
    searchByEmail(email: string): Promise<CustomerLookup[]>;
    studioName(studioId: number): Promise<string>;
  };
  config: OtpConfig;
  logger: Logger;
};

/** What the widget may see about an account: no ids, only a masked number. */
export type AccountChoice = {
  index: number;
  studioName: string;
  status: CustomerStatus;
  maskedNumber: string;
};

export type VerifyOutcome =
  | { kind: 'verified'; accounts: AccountChoice[]; selected: number | null }
  | { kind: 'invalid' }
  | { kind: 'locked' }
  | { kind: 'expired' }
  | { kind: 'lookup_failed' };

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export function hashEmail(secret: string, email: string): string {
  return createHmac('sha256', secret).update(`email:${email.trim().toLowerCase()}`).digest('hex');
}

export function hashCode(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`code:${challengeId}:${code}`).digest('hex');
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function toChoice(candidate: AccountCandidate, index: number): AccountChoice {
  return {
    index,
    studioName: candidate.studioName,
    status: candidate.status,
    maskedNumber: candidate.maskedNumber,
  };
}

function maskNumber(lookup: CustomerLookup): string {
  const visible = (lookup.customerNumber ?? String(lookup.customerId)).replace(/\W/g, '').slice(-3);
  return `•••${visible.padStart(3, '0')}`;
}

/**
 * Emails a one-time code. Always resolves the same way (no hint whether the email has an account);
 * when the email hit its challenge limit, nothing is sent.
 */
export async function requestLoginCode(
  deps: LoginDeps,
  input: { conversationId: string; email: string; lang: Lang },
): Promise<void> {
  const email = emailSchema.parse(input.email);
  const id = randomUUID();
  const code = generateCode();
  const created = await deps.auth.createOtpChallenge({
    id,
    conversationId: input.conversationId,
    emailHash: hashEmail(deps.config.secret, email),
    codeHash: hashCode(deps.config.secret, id, code),
    ttlSeconds: deps.config.ttlSeconds,
    maxPerWindow: deps.config.maxPerWindow,
    windowSeconds: deps.config.windowSeconds,
  });
  if (!created) {
    deps.logger.warn(
      { conversationId: input.conversationId },
      'login code rate-limited for this email',
    );
    return;
  }
  await deps.email.sendLoginCode({
    to: email,
    code,
    lang: input.lang,
    validMinutes: Math.round(deps.config.ttlSeconds / 60),
  });
  deps.logger.info({ conversationId: input.conversationId }, 'login code sent');
}

export async function verifyLoginCode(
  deps: LoginDeps,
  input: { conversationId: string; email: string; code: string },
): Promise<VerifyOutcome> {
  if (!/^\d{6}$/.test(input.code)) return { kind: 'invalid' };
  const emailHash = hashEmail(deps.config.secret, input.email);
  const challengeId = await deps.auth.latestOpenChallengeId(input.conversationId, emailHash);
  if (!challengeId) return { kind: 'expired' };
  const result = await deps.auth.verifyOtpAttempt({
    challengeId,
    conversationId: input.conversationId,
    codeHash: hashCode(deps.config.secret, challengeId, input.code),
    maxAttempts: deps.config.maxAttempts,
  });
  deps.logger.info({ conversationId: input.conversationId, result }, 'login code checked');
  if (result === 'not_found') return { kind: 'expired' };
  if (result !== 'ok') return { kind: result };
  return lookupAccounts(deps, input);
}

/**
 * Finds the verified email's Magicline accounts and stores them as candidates; binds the account
 * when there is exactly one. Also used to retry after a Magicline failure (same email required).
 */
export async function lookupAccounts(
  deps: LoginDeps,
  input: { conversationId: string; email: string },
): Promise<VerifyOutcome> {
  // Only for the email this conversation was verified with.
  const state = await deps.auth.getAuthState(input.conversationId);
  if (!state.verified || state.verifiedEmailHash !== hashEmail(deps.config.secret, input.email)) {
    return { kind: 'expired' };
  }

  let candidates: AccountCandidate[];
  try {
    const lookups = await deps.magicline.searchByEmail(emailSchema.parse(input.email));
    const names = new Map<number, string>();
    for (const studioId of new Set(lookups.map((l) => l.studioId))) {
      names.set(studioId, await deps.magicline.studioName(studioId));
    }
    candidates = lookups.map((lookup) => ({
      customerId: lookup.customerId,
      studioId: lookup.studioId,
      status: lookup.status,
      studioName: names.get(lookup.studioId) ?? '',
      maskedNumber: maskNumber(lookup),
    }));
  } catch (error) {
    deps.logger.error(
      { err: error, conversationId: input.conversationId },
      'account lookup failed',
    );
    return { kind: 'lookup_failed' };
  }

  await deps.auth.setAccountCandidates(input.conversationId, candidates);
  const selected =
    candidates.length === 1 && (await deps.auth.bindAccount(input.conversationId, 0)) ? 0 : null;
  deps.logger.info(
    { conversationId: input.conversationId, accounts: candidates.length },
    'accounts found',
  );
  return { kind: 'verified', accounts: candidates.map(toChoice), selected };
}

export async function selectAccount(
  deps: LoginDeps,
  input: { conversationId: string; index: number },
): Promise<AccountChoice | null> {
  if (!Number.isInteger(input.index) || input.index < 0) return null;
  if (!(await deps.auth.bindAccount(input.conversationId, input.index))) return null;
  const candidate = (await deps.auth.getAuthState(input.conversationId)).candidates?.[input.index];
  return candidate ? toChoice(candidate, input.index) : null;
}
