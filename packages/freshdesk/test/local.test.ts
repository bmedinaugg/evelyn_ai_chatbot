import { describe, expect, it } from 'vitest';
import { createLocalFreshdesk } from '../src/index.ts';

describe('createLocalFreshdesk', () => {
  it('refuses to exist outside APP_ENV=local', () => {
    expect(() => createLocalFreshdesk({ appEnv: 'preprod' })).toThrow(/APP_ENV=local/);
    expect(() => createLocalFreshdesk({ appEnv: 'prod' })).toThrow(/APP_ENV=local/);
  });

  it('prints tickets and notes instead of sending them, without the requester email', async () => {
    const lines: string[] = [];
    const fd = createLocalFreshdesk({ appEnv: 'local', write: (line) => lines.push(line) });
    const first = await fd.createTicket({
      email: 'sam@example.com',
      name: 'Sam',
      subject: 'Dubbel afgeschreven',
      descriptionText: 'Twee keer',
      tags: ['chatbot', 'escalation', 'nl'],
      type: 'Payments',
    });
    const second = await fd.createTicket({
      email: 'x@example.com',
      subject: 'Lead',
      descriptionText: 'q',
      tags: [],
    });
    await fd.addPrivateNote(first.id, 'Klant: Hoi\nChatbot: Hallo');
    expect(second.id).toBe(first.id + 1);
    const out = lines.join('\n');
    expect(out).toContain(`[local freshdesk] ticket #${first.id}`);
    expect(out).toContain('Dubbel afgeschreven');
    expect(out).toContain('type=Payments');
    expect(out).toContain('Klant: Hoi');
    expect(out).not.toContain('sam@example.com');
  });

  it('offers ticket fields with topic choices', async () => {
    const fd = createLocalFreshdesk({ appEnv: 'local', write: () => {} });
    const fields = await fd.listTicketFields();
    expect(fields.find((f) => f.name === 'ticket_type')?.choices.length).toBeGreaterThan(0);
  });
});
