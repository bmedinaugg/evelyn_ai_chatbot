import {
  type ApiHistoryEntry,
  ClaimLostError,
  type ConversationRecord,
  type ConversationRepository,
  type FaqRepository,
  type FaqSearchHit,
  type FlagReason,
  type StoredMessage,
} from '@trainmore/db';

export type StoredTurn = {
  user: StoredMessage;
  steps?: ApiHistoryEntry[];
  assistant: StoredMessage | null;
  flags: FlagReason[];
};

export function fakeConversations(
  record: ConversationRecord,
  options: { loseClaim?: boolean } = {},
) {
  const turns: StoredTurn[] = [];
  const releases: string[] = [];
  const feedback: { messageId: number; rating: 'up' | 'down' }[] = [];
  let claimed = false;
  const repo: ConversationRepository = {
    async create() {
      return { id: record.id };
    },
    async get(id) {
      return id === record.id
        ? { ...record, userMessageCount: record.userMessageCount + turns.length }
        : null;
    },
    async claimTurn() {
      if (claimed) return null;
      claimed = true;
      return 'claim-1';
    },
    async releaseTurn(_id, claimId) {
      releases.push(claimId);
      claimed = false;
    },
    async listApiHistory(): Promise<ApiHistoryEntry[]> {
      return turns.flatMap((turn) => [
        { role: 'user' as const, content: turn.user.apiContent },
        ...(turn.steps ?? []),
        ...(turn.assistant
          ? [{ role: 'assistant' as const, content: turn.assistant.apiContent }]
          : []),
      ]);
    },
    async appendTurn(input) {
      if (options.loseClaim) throw new ClaimLostError();
      turns.push({
        user: input.user,
        steps: input.steps ?? [],
        assistant: input.assistant,
        flags: input.flags,
      });
      claimed = false;
      // Assistant reply ids are the turn number (1-based) in this fake.
      return input.assistant ? turns.length : null;
    },
    async recordFeedback(_conversationId, messageId, rating) {
      const turn = turns[messageId - 1];
      if (!turn?.assistant) return false;
      feedback.push({ messageId, rating });
      return true;
    },
    async recordLead() {},
    async lastAssistantOutcome() {
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const outcome = turns[i]?.assistant?.outcome;
        if (outcome) return outcome;
      }
      return null;
    },
    async listTranscript() {
      return turns.flatMap((turn) => [
        { role: 'user' as const, text: turn.user.displayText },
        ...(turn.assistant
          ? [{ role: 'assistant' as const, text: turn.assistant.displayText }]
          : []),
      ]);
    },
  };
  return {
    repo,
    turns,
    releases,
    feedback,
    isClaimed: () => claimed,
    claim: () => (claimed = true),
  };
}

export function fakeFaq(hits: FaqSearchHit[]): FaqRepository {
  return {
    async getActiveSummaries() {
      return [];
    },
    async getActiveContentHashes() {
      return new Map();
    },
    async countActive() {
      return hits.length;
    },
    async upsert() {},
    async softDeleteAllExcept() {
      return 0;
    },
    async search() {
      return hits;
    },
  };
}
