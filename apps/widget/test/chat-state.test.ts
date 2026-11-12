import { describe, expect, it } from 'vitest';
import type { ApiReply } from '../src/lib/api.ts';
import {
  type ChatState,
  chatReducer,
  initialChatState,
  ticketPrefill,
} from '../src/lib/chat-state.ts';

const reply: ApiReply = { text: 'Via de app.', lang: 'nl', citations: [], action: 'none' };
const ready = (): ChatState => chatReducer(initialChatState(false), { type: 'consent_given' });

describe('chatReducer', () => {
  it('starts at consent unless already given', () => {
    expect(initialChatState(false).phase).toBe('consent');
    expect(initialChatState(true).phase).toBe('ready');
  });

  it('adds the user message and blocks input while sending', () => {
    const state = chatReducer(ready(), { type: 'send_started', text: 'Hoe zeg ik op?' });
    expect(state.phase).toBe('sending');
    expect(state.messages).toEqual([{ id: 1, role: 'user', text: 'Hoe zeg ik op?' }]);
  });

  it('ignores a second send while one is in flight', () => {
    const sending = chatReducer(ready(), { type: 'send_started', text: 'a' });
    expect(chatReducer(sending, { type: 'send_started', text: 'b' })).toBe(sending);
  });

  it('adds the bot reply', () => {
    const sending = chatReducer(ready(), { type: 'send_started', text: 'q' });
    const done = chatReducer(sending, { type: 'send_succeeded', reply });
    expect(done.phase).toBe('ready');
    expect(done.messages[1]).toEqual({
      id: 2,
      role: 'bot',
      text: 'Via de app.',
      citations: [],
      action: 'none',
    });
  });

  it('a busy error keeps the user message once and shows a notice', () => {
    const sending = chatReducer(ready(), { type: 'send_started', text: 'q' });
    const failed = chatReducer(sending, { type: 'send_failed', notice: 'busy' });
    expect(failed.phase).toBe('ready');
    expect(failed.messages).toHaveLength(1);
    expect(failed.notice).toBe('busy');
  });

  it('opens and completes the lead form', () => {
    const withForm = chatReducer(ready(), { type: 'lead_form_opened' });
    expect(withForm.leadForm).toBe('open');
    expect(chatReducer(withForm, { type: 'lead_submitted' }).leadForm).toBe('submitted');
    expect(chatReducer(withForm, { type: 'lead_form_closed' }).leadForm).toBe('closed');
  });

  it('remembers the rating of a reply and lets it change', () => {
    let state = chatReducer(ready(), { type: 'send_started', text: 'q' });
    state = chatReducer(state, { type: 'send_succeeded', reply: { ...reply, messageId: 7 } });
    const bot = state.messages.at(-1);
    if (bot?.role !== 'bot') throw new Error('no bot message');
    expect(bot.messageId).toBe(7);
    state = chatReducer(state, { type: 'feedback_given', id: bot.id, rating: 'up' });
    state = chatReducer(state, { type: 'feedback_given', id: bot.id, rating: 'down' });
    expect(state.messages.at(-1)).toMatchObject({ rating: 'down' });
    state = chatReducer(state, { type: 'feedback_given', id: bot.id, rating: undefined });
    expect(state.messages.at(-1)).not.toHaveProperty('rating');
  });

  it('opens and completes the ticket form', () => {
    const withForm = chatReducer(ready(), { type: 'ticket_form_opened' });
    expect(withForm.ticketForm).toBe('open');
    expect(chatReducer(withForm, { type: 'ticket_submitted' }).ticketForm).toBe('submitted');
    expect(chatReducer(withForm, { type: 'ticket_form_closed' }).ticketForm).toBe('closed');
    expect(chatReducer(withForm, { type: 'new_chat' }).ticketForm).toBe('closed');
  });

  it('new chat clears messages but keeps consent', () => {
    const state = chatReducer(chatReducer(ready(), { type: 'send_started', text: 'q' }), {
      type: 'send_succeeded',
      reply,
    });
    const fresh = chatReducer(state, { type: 'new_chat' });
    expect(fresh.messages).toEqual([]);
    expect(fresh.phase).toBe('ready');
  });
});

describe('ticketPrefill', () => {
  it('uses the first question as subject and all questions as description', () => {
    let state = ready();
    for (const text of ['Dubbel afgeschreven', 'Wat nu?']) {
      state = chatReducer(state, { type: 'send_started', text });
      state = chatReducer(state, { type: 'send_succeeded', reply });
    }
    expect(ticketPrefill(state.messages)).toEqual({
      subject: 'Dubbel afgeschreven',
      description: 'Dubbel afgeschreven\n\nWat nu?',
    });
  });

  it('keeps the subject on one short line', () => {
    const state = chatReducer(ready(), { type: 'send_started', text: `a\nb ${'x'.repeat(200)}` });
    const { subject } = ticketPrefill(state.messages);
    expect(subject.startsWith('a b x')).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(100);
  });

  it('is empty without messages', () => {
    expect(ticketPrefill([])).toEqual({ subject: '', description: '' });
  });
});
