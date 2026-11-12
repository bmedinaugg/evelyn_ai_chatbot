import type { CustomerStatus } from '@trainmore/db';
import { type Lang, t } from '@trainmore/i18n';

export const MAX_NOTE_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 2000;

/**
 * Private note for a chat ticket: what the customer saw and typed (display texts only, never
 * API content or tool data) and, when logged in, only the status and club name.
 */
export function buildTicketNote(input: {
  lang: Lang;
  transcript: { role: 'user' | 'assistant'; text: string }[];
  account: { status: CustomerStatus; clubName: string } | null;
  /** Topic chosen in the form (also the ticket type once topics are synced). */
  topic: string;
}): string {
  const { lang } = input;
  const accountLine = input.account
    ? t(lang, 'ticket.account', {
        status: t(lang, `widget.status.${input.account.status}`),
        club: input.account.clubName,
      })
    : t(lang, 'ticket.notLoggedIn');
  const messages = input.transcript.slice(-MAX_NOTE_MESSAGES).map((message) => {
    const speaker = t(lang, message.role === 'user' ? 'ticket.customer' : 'ticket.bot');
    // One line per message, so a message cannot pose as another speaker.
    const text = message.text.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_CHARS);
    return `${speaker}: ${text}`;
  });
  return [
    t(lang, 'ticket.noteTitle'),
    t(lang, 'ticket.topic', { topic: input.topic }),
    accountLine,
    '',
    ...messages,
  ].join('\n');
}
