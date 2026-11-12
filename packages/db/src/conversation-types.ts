import type { Lang } from '@trainmore/i18n';

export type CustomerStatus = 'MEMBER' | 'PROSPECT' | 'FORMER_MEMBER';

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
  /**
   * Claims the next turn and returns a claim id, or null if another turn is in flight.
   * Claims expire after 60 s; a newer claim makes the old one invalid.
   */
  claimTurn(id: string): Promise<string | null>;
  /** No-op unless claimId is still the current claim. */
  releaseTurn(id: string, claimId: string): Promise<void>;
  /** Ordered (by message id) API history for replay. */
  listApiHistory(id: string): Promise<ApiHistoryEntry[]>;
  /** Outcome of the latest assistant message, if any. */
  lastAssistantOutcome(id: string): Promise<Outcome | null>;
  /** What the customer saw and typed (no tool steps), oldest first, at most the last 50 messages. */
  listTranscript(id: string): Promise<{ role: 'user' | 'assistant'; text: string }[]>;
  /**
   * Atomically inserts the user message, optional assistant message and flags; bumps counters;
   * releases the claim. Throws ClaimLostError if claimId is no longer the current claim.
   */
  appendTurn(input: {
    conversationId: string;
    claimId: string;
    user: StoredMessage;
    /** Tool calls and results between the question and the final answer (only with an answer). */
    steps?: ApiHistoryEntry[];
    assistant: StoredMessage | null;
    flags: FlagReason[];
  }): Promise<void>;
  recordLead(input: {
    conversationId: string | null;
    freshdeskTicketId: number;
    lang: Lang;
  }): Promise<void>;
}

/** The turn's claim expired and another request took it over; this turn's result must be dropped. */
export class ClaimLostError extends Error {
  constructor() {
    super('Conversation turn claim lost');
    this.name = 'ClaimLostError';
  }
}
