import type { Lang } from '@trainmore/i18n';

export const OUTCOMES = [
  'answered',
  'declined',
  'unsupported',
  'handoff',
  'no_match',
  'invalid_citation',
  'refusal',
  'error',
  'limit',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const FLAG_REASONS = [
  'no_match',
  'low_confidence',
  'invalid_citation',
  'needs_human',
  'wants_human',
  'account_question',
  'refusal',
  'error',
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export type Citation = { articleId: number; title: string; url: string };

export type StoredMessage = {
  displayText: string;
  /** Exactly what was sent to / received from the Claude API; replayed unchanged. */
  apiContent: unknown;
  outcome?: Outcome;
  citations?: Citation[];
};

export type ConversationRecord = {
  id: string;
  tokenHash: string;
  lang: Lang;
  userMessageCount: number;
};

export type ApiHistoryEntry = { role: 'user' | 'assistant'; content: unknown };

export interface ConversationRepository {
  create(input: { tokenHash: string; lang: Lang }): Promise<{ id: string }>;
  get(id: string): Promise<ConversationRecord | null>;
  /** true if this caller now owns the turn; false if another turn is in flight (claims expire after 60 s). */
  claimTurn(id: string): Promise<boolean>;
  releaseTurn(id: string): Promise<void>;
  /** Ordered (by message id) API history for replay. */
  listApiHistory(id: string): Promise<ApiHistoryEntry[]>;
  /** Atomically inserts the user message, optional assistant message and flags; bumps counters; releases the claim. */
  appendTurn(input: {
    conversationId: string;
    user: StoredMessage;
    assistant: StoredMessage | null;
    flags: FlagReason[];
  }): Promise<void>;
  recordLead(input: {
    conversationId: string | null;
    freshdeskTicketId: number;
    lang: Lang;
  }): Promise<void>;
}
