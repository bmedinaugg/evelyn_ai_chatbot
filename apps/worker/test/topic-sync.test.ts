import { Writable } from 'node:stream';
import type { EscalationRepository } from '@trainmore/db';
import type { FreshdeskClient, TicketField } from '@trainmore/freshdesk';
import { createLogger } from '@trainmore/shared';
import { describe, expect, it } from 'vitest';
import { runTopicSync, TopicSyncAbortedError } from '../src/topic-sync.ts';

const logger = createLogger({
  name: 'test',
  level: 'fatal',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});

function fakeFreshdesk(fields: TicketField[] | Error): Pick<FreshdeskClient, 'listTicketFields'> {
  return {
    async listTicketFields() {
      if (fields instanceof Error) throw fields;
      return fields;
    },
  };
}

function fakeRepo() {
  const replaced: string[][] = [];
  const repo: Pick<EscalationRepository, 'replaceTopics'> = {
    async replaceTopics(values) {
      replaced.push([...values]);
    },
  };
  return { repo, replaced };
}

describe('runTopicSync', () => {
  it('replaces the topics with the choices of the configured field', async () => {
    const { repo, replaced } = fakeRepo();
    const result = await runTopicSync({
      freshdesk: fakeFreshdesk([
        { name: 'priority', choices: [] },
        { name: 'ticket_type', choices: [' Membership ', 'Payments', 'Payments', ''] },
      ]),
      repo,
      field: 'ticket_type',
      logger,
    });
    expect(replaced).toEqual([['Membership', 'Payments']]);
    expect(result).toEqual({ topics: 2 });
  });

  it('changes nothing when Freshdesk is down', async () => {
    const { repo, replaced } = fakeRepo();
    const run = runTopicSync({
      freshdesk: fakeFreshdesk(new Error('503')),
      repo,
      field: 'ticket_type',
      logger,
    });
    await expect(run).rejects.toMatchObject({ reason: 'fetch_failed' });
    await expect(run).rejects.toBeInstanceOf(TopicSyncAbortedError);
    expect(replaced).toEqual([]);
  });

  it('changes nothing when the field is missing', async () => {
    const { repo, replaced } = fakeRepo();
    await expect(
      runTopicSync({
        freshdesk: fakeFreshdesk([{ name: 'priority', choices: ['High'] }]),
        repo,
        field: 'ticket_type',
        logger,
      }),
    ).rejects.toMatchObject({ reason: 'field_missing' });
    expect(replaced).toEqual([]);
  });

  it('changes nothing when the field has no choices', async () => {
    const { repo, replaced } = fakeRepo();
    await expect(
      runTopicSync({
        freshdesk: fakeFreshdesk([{ name: 'ticket_type', choices: ['  '] }]),
        repo,
        field: 'ticket_type',
        logger,
      }),
    ).rejects.toMatchObject({ reason: 'empty_choices' });
    expect(replaced).toEqual([]);
  });
});
