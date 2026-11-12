export { createSupabaseAuthRepository } from './auth-repository.ts';
export type { AccountCandidate, AuthRepository, AuthState, VerifyResult } from './auth-types.ts';
export {
  type CapabilityFlagRepository,
  createSupabaseCapabilityFlagRepository,
} from './capability-flags.ts';
export { createServiceClient, DbError, type ServiceClient } from './client.ts';
export { createSupabaseConversationRepository } from './conversation-repository.ts';
export {
  type ApiHistoryEntry,
  type Citation,
  ClaimLostError,
  type ConversationRecord,
  type ConversationRepository,
  type CustomerStatus,
  FLAG_REASONS,
  type FlagReason,
  OUTCOMES,
  type Outcome,
  type StoredMessage,
} from './conversation-types.ts';
export {
  createSupabaseEscalationRepository,
  type EscalationReason,
  type EscalationRepository,
} from './escalation-repository.ts';
export { createSupabaseFaqRepository } from './faq-repository.ts';
export type {
  ActiveFaqSummary,
  FaqArticleRecord,
  FaqRepository,
  FaqSearchHit,
  FaqTranslation,
} from './faq-types.ts';
export type { Database } from './generated/database.types.ts';
