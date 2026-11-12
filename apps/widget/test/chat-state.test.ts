import { describe, expect, it } from 'vitest';
import type { ApiReply } from '../src/lib/api.ts';
import { type ChatState, chatReducer, initialChatState } from '../src/lib/chat-state.ts';

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
