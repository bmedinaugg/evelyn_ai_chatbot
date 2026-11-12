import type { EscalationRepository } from '@trainmore/db';
import type { FreshdeskClient } from '@trainmore/freshdesk';
import type { Logger } from '@trainmore/shared';

export type TopicSyncDeps = {
  freshdesk: Pick<FreshdeskClient, 'listTicketFields'>;
  repo: Pick<EscalationRepository, 'replaceTopics'>;
  /** Freshdesk ticket field whose choices are the ticket form topics (e.g. ticket_type). */
  field: string;
  logger: Logger;
};

export type TopicSyncAbortReason = 'fetch_failed' | 'field_missing' | 'empty_choices';

export class TopicSyncAbortedError extends Error {
  readonly reason: TopicSyncAbortReason;

  constructor(reason: TopicSyncAbortReason, options?: ErrorOptions) {
    super(`Ticket topic sync aborted: ${reason}`, options);
    this.name = 'TopicSyncAbortedError';
    this.reason = reason;
  }
}

/**
 * Mirrors the choices of one Freshdesk ticket field into the ticket form topics.
 * Any failure or an empty result leaves the current topics unchanged.
 */
export async function runTopicSync(deps: TopicSyncDeps): Promise<{ topics: number }> {
  let fields: Awaited<ReturnType<TopicSyncDeps['freshdesk']['listTicketFields']>>;
  try {
    fields = await deps.freshdesk.listTicketFields();
  } catch (error) {
    deps.logger.error({ err: error }, 'topic sync aborted: listing failed');
    throw new TopicSyncAbortedError('fetch_failed', { cause: error });
  }

  const field = fields.find((f) => f.name === deps.field);
  if (!field) {
    deps.logger.error({ field: deps.field }, 'topic sync aborted: field missing');
    throw new TopicSyncAbortedError('field_missing');
  }

  const topics = [...new Set(field.choices.map((c) => c.trim()).filter((c) => c !== ''))];
  if (topics.length === 0) {
    deps.logger.error({ field: deps.field }, 'topic sync aborted: no choices');
    throw new TopicSyncAbortedError('empty_choices');
  }

  await deps.repo.replaceTopics(topics);
  deps.logger.info({ field: deps.field, topics: topics.length }, 'ticket topics synced');
  return { topics: topics.length };
}
