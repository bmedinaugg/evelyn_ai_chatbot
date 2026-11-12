import { DbError, type ServiceClient } from './client.ts';

/** Scheduled data removal (retention job) and deletion requests. Counts only, never content. */
export interface RetentionRepository {
  /** Anonymises up to `limit` conversations without activity since `before`; returns the count. */
  anonymiseConversations(before: Date, limit: number): Promise<number>;
  purgeOtpChallenges(before: Date): Promise<number>;
  /** Clears customer ids and account candidates of logins verified before `before`. */
  clearAccountBindings(before: Date): Promise<number>;
  /** Deletes the conversations verified with this email hash and its login codes. */
  dsarDelete(emailHash: string): Promise<{ conversations: number; otpChallenges: number }>;
}

export function createSupabaseRetentionRepository(client: ServiceClient): RetentionRepository {
  const count = (fn: string, data: unknown, error: { code: string } | null): number => {
    if (error) throw new DbError(fn, error.code);
    if (typeof data !== 'number') throw new DbError(fn, 'unexpected_result');
    return data;
  };
  return {
    async anonymiseConversations(before, limit) {
      const { data, error } = await client.rpc('anonymise_conversations', {
        p_before: before.toISOString(),
        p_limit: limit,
      });
      return count('anonymise_conversations', data, error);
    },
    async purgeOtpChallenges(before) {
      const { data, error } = await client.rpc('purge_otp_challenges', {
        p_before: before.toISOString(),
      });
      return count('purge_otp_challenges', data, error);
    },
    async clearAccountBindings(before) {
      const { data, error } = await client.rpc('clear_account_bindings', {
        p_before: before.toISOString(),
      });
      return count('clear_account_bindings', data, error);
    },
    async dsarDelete(emailHash) {
      const { data, error } = await client.rpc('dsar_delete', { p_email_hash: emailHash });
      if (error) throw new DbError('dsar_delete', error.code);
      const row = Array.isArray(data) ? data[0] : undefined;
      if (!row || typeof row.conversations !== 'number' || typeof row.otp_challenges !== 'number')
        throw new DbError('dsar_delete', 'unexpected_result');
      return { conversations: row.conversations, otpChallenges: row.otp_challenges };
    },
  };
}
