import type {
  ApiHistoryEntry,
  ConversationRecord,
  ConversationRepository,
  FaqRepository,
  FaqSearchHit,
  FlagReason,
  StoredMessage,
} from '@trainmore/db';

export type StoredTurn = {
  user: StoredMessage;
  assistant: StoredMessage | null;
  flags: FlagReason[];
};

export function fakeConversations(record: ConversationRecord) {
  const turns: StoredTurn[] = [];
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
      if (claimed) return false;
      claimed = true;
      return true;
    },
    async releaseTurn() {
      claimed = false;
    },
    async listApiHistory(): Promise<ApiHistoryEntry[]> {
      return turns.flatMap((turn) => [
        { role: 'user' as const, content: turn.user.apiContent },
        ...(turn.assistant
          ? [{ role: 'assistant' as const, content: turn.assistant.apiContent }]
          : []),
      ]);
    },
    async appendTurn(input) {
      turns.push({ user: input.user, assistant: input.assistant, flags: input.flags });
      claimed = false;
    },
    async recordLead() {},
  };
  return { repo, turns, isClaimed: () => claimed, claim: () => (claimed = true) };
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
