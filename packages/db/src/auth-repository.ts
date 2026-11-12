import { z } from 'zod';
import type { AccountCandidate, AuthRepository, AuthState, VerifyResult } from './auth-types.ts';
import { DbError, type ServiceClient } from './client.ts';
import type { Json } from './generated/database.types.ts';

const statusSchema = z.enum(['MEMBER', 'PROSPECT', 'FORMER_MEMBER']);
const candidateSchema = z.object({
  customerId: z.number().int(),
  studioId: z.number().int(),
  status: statusSchema,
  studioName: z.string(),
  maskedNumber: z.string(),
});
const verifyResultSchema = z.enum(['ok', 'invalid', 'locked', 'expired', 'not_found']);
const stateRowSchema = z.object({
  verified_at: z.string().nullable(),
  verified_email_hash: z.string().nullable(),
  account_candidates: z.array(candidateSchema).nullable(),
  customer_id: z.number().int().nullable(),
  studio_id: z.number().int().nullable(),
  customer_status: statusSchema.nullable(),
});

export function createSupabaseAuthRepository(client: ServiceClient): AuthRepository {
  return {
    async createOtpChallenge(input) {
      const { data, error } = await client.rpc('create_otp_challenge', {
        p_id: input.id,
        p_conversation_id: input.conversationId,
        p_email_hash: input.emailHash,
        p_code_hash: input.codeHash,
        p_ttl_seconds: input.ttlSeconds,
        p_max_per_window: input.maxPerWindow,
        p_window_seconds: input.windowSeconds,
      });
      if (error) throw new DbError('create_otp_challenge', error.code);
      return z.boolean().parse(data);
    },

    async latestOpenChallengeId(conversationId, emailHash) {
      const { data, error } = await client
        .from('otp_challenges')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('email_hash', emailHash)
        .is('consumed_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new DbError('otp_challenges select', error.code);
      return data?.id ?? null;
    },

    async verifyOtpAttempt(input): Promise<VerifyResult> {
      const { data, error } = await client.rpc('verify_otp_attempt', {
        p_challenge_id: input.challengeId,
        p_conversation_id: input.conversationId,
        p_code_hash: input.codeHash,
        p_max_attempts: input.maxAttempts,
      });
      if (error) throw new DbError('verify_otp_attempt', error.code);
      return verifyResultSchema.parse(data);
    },

    async setAccountCandidates(conversationId, candidates: AccountCandidate[]) {
      const { error } = await client.rpc('set_account_candidates', {
        p_conversation_id: conversationId,
        p_candidates: candidates as unknown as Json,
      });
      if (error) throw new DbError('set_account_candidates', error.code);
    },

    async bindAccount(conversationId, index) {
      const { data, error } = await client.rpc('bind_account', {
        p_conversation_id: conversationId,
        p_index: index,
      });
      if (error) throw new DbError('bind_account', error.code);
      return z.boolean().parse(data);
    },

    async getAuthState(conversationId): Promise<AuthState> {
      const { data, error } = await client
        .from('conversations')
        .select(
          'verified_at, verified_email_hash, account_candidates, customer_id, studio_id, customer_status',
        )
        .eq('id', conversationId)
        .maybeSingle();
      if (error) throw new DbError('conversations auth select', error.code);
      if (!data)
        return { verified: false, verifiedEmailHash: null, candidates: null, account: null };
      const row = stateRowSchema.parse(data);
      return {
        verified: row.verified_at !== null,
        verifiedEmailHash: row.verified_email_hash,
        candidates: row.account_candidates,
        account:
          row.customer_id !== null && row.studio_id !== null && row.customer_status !== null
            ? { customerId: row.customer_id, studioId: row.studio_id, status: row.customer_status }
            : null,
      };
    },
  };
}
