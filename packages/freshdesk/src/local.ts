import type { FreshdeskClient } from './client.ts';

/**
 * Local development only: prints tickets, notes and leads instead of sending them to Freshdesk, so
 * the forms can be tried without touching the live helpdesk. Refuses to exist outside APP_ENV=local.
 * The requester's email is not printed.
 */
export function createLocalFreshdesk(opts: {
  appEnv: string;
  write?: (line: string) => void;
}): Pick<FreshdeskClient, 'createTicket' | 'addPrivateNote' | 'listTicketFields'> {
  if (opts.appEnv !== 'local')
    throw new Error('The local Freshdesk stand-in only works with APP_ENV=local');
  const write = opts.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  let nextId = 1;
  return {
    async createTicket(input) {
      const id = nextId;
      nextId += 1;
      write(
        `[local freshdesk] ticket #${id} type=${input.type ?? '-'} tags=${input.tags.join(',')}\n` +
          `  subject: ${input.subject}\n  ${input.descriptionText.replace(/\n/g, '\n  ')}`,
      );
      return { id };
    },
    async addPrivateNote(ticketId, text) {
      write(`[local freshdesk] private note on #${ticketId}\n  ${text.replace(/\n/g, '\n  ')}`);
    },
    async listTicketFields() {
      return [
        {
          name: 'ticket_type',
          choices: [
            'Membership & contract',
            'Payments & invoices',
            'Club & facilities',
            'App & account',
          ],
        },
      ];
    },
  };
}
