export { createServiceClient, DbError, type ServiceClient } from './client.ts';
export { createSupabaseConversationRepository } from './conversation-repository.ts';
export {
  type ApiHistoryEntry,
  type Citation,
  ClaimLostError,
  type ConversationRecord,
  type ConversationRepository,
  FLAG_REASONS,
  type FlagReason,
  OUTCOMES,
  type Outcome,
  type StoredMessage,
} from './conversation-types.ts';
export { createSupabaseFaqRepository } from './faq-repository.ts';
export type {
  ActiveFaqSummary,
  FaqArticleRecord,
  FaqRepository,
  FaqSearchHit,
  FaqTranslation,
} from './faq-types.ts';
export type { Database } from './generated/database.types.ts';
