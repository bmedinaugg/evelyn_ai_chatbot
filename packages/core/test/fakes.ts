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
    },
    async recordLead() {},
  };
  return { repo, turns, releases, isClaimed: () => claimed, claim: () => (claimed = true) };
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
