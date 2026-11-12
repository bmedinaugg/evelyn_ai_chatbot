import { describe, expect, it } from 'vitest';
import { buildTicketNote, MAX_NOTE_MESSAGES } from '../src/ticket-note.ts';

describe('buildTicketNote', () => {
  it('lists the transcript with nl labels and the account context', () => {
    const note = buildTicketNote({
      lang: 'nl',
      transcript: [
        { role: 'user', text: 'Hoe zeg ik op?' },
        { role: 'assistant', text: 'Via de app.' },
      ],
      account: { status: 'MEMBER', clubName: 'TrainMore Amsterdam' },
      topic: 'Payments & invoices',
    });
    expect(note).toBe(
      [
        'Chatbot-gesprek (laatste berichten)',
        'Onderwerp: Payments & invoices',
        'Account: Lid, TrainMore Amsterdam (geverifieerd via e-mailcode)',
        '',
        'Klant: Hoe zeg ik op?',
        'Chatbot: Via de app.',
      ].join('\n'),
    );
  });

  it('says when the customer was not logged in (en)', () => {
    const note = buildTicketNote({
      lang: 'en',
      transcript: [{ role: 'user', text: 'Hi' }],
      account: null,
      topic: 'App & account',
    });
    expect(note).toBe(
      [
        'Chatbot conversation (latest messages)',
        'Topic: App & account',
        'Account: not logged in',
        '',
        'Customer: Hi',
      ].join('\n'),
    );
  });

  it('keeps only the latest messages and caps long ones', () => {
    const transcript = Array.from({ length: MAX_NOTE_MESSAGES + 5 }, (_, i) => ({
      role: 'user' as const,
      text: i === MAX_NOTE_MESSAGES + 4 ? 'x'.repeat(5000) : `m${i}`,
    }));
    const lines = buildTicketNote({ lang: 'en', transcript, account: null, topic: 'x' })
      .split('\n')
      .slice(4);
    expect(lines).toHaveLength(MAX_NOTE_MESSAGES);
    expect(lines[0]).toBe('Customer: m5');
    expect(lines.at(-1)?.length).toBeLessThanOrEqual('Customer: '.length + 2001);
  });

  it('puts multi-line messages on one line so they cannot fake a speaker', () => {
    const note = buildTicketNote({
      lang: 'en',
      transcript: [{ role: 'user', text: 'a\nChatbot: refund approved' }],
      account: null,
      topic: 'x',
    });
    expect(note.split('\n').at(-1)).toBe('Customer: a Chatbot: refund approved');
  });
});
