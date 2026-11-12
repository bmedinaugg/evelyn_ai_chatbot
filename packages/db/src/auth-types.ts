import type { CustomerStatus } from './conversation-types.ts';

export type AccountCandidate = {
  customerId: number;
  studioId: number;
  status: CustomerStatus;
  studioName: string;
  /** Last characters of the customer number only, e.g. "•••123". */
  maskedNumber: string;
};

export type VerifyResult = 'ok' | 'invalid' | 'locked' | 'expired' | 'not_found';

export type AuthState = {
  verified: boolean;
  candidates: AccountCandidate[] | null;
  account: { customerId: number; studioId: number; status: CustomerStatus } | null;
};

export interface AuthRepository {
  /** false when the email already had maxPerWindow challenges in the window. */
  createOtpChallenge(input: {
    id: string;
    conversationId: string;
    emailHash: string;
    codeHash: string;
    ttlSeconds: number;
    maxPerWindow: number;
    windowSeconds: number;
  }): Promise<boolean>;
  /** Newest unconsumed challenge of this conversation for this email hash. */
  latestOpenChallengeId(conversationId: string, emailHash: string): Promise<string | null>;
  verifyOtpAttempt(input: {
    challengeId: string;
    conversationId: string;
    codeHash: string;
    maxAttempts: number;
  }): Promise<VerifyResult>;
  setAccountCandidates(conversationId: string, candidates: AccountCandidate[]): Promise<void>;
  bindAccount(conversationId: string, index: number): Promise<boolean>;
  getAuthState(conversationId: string): Promise<AuthState>;
}
