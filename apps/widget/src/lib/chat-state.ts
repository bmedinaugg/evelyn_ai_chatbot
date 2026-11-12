import type { ApiReply } from './api.ts';
import type { ReplyAction } from './types.ts';

export type ChatMessage =
  | { id: number; role: 'user'; text: string }
  | {
      id: number;
      role: 'bot';
      text: string;
      citations: ApiReply['citations'];
      action: ReplyAction;
      contactUrl?: string;
    };

export type Notice = 'busy' | 'rate_limited' | 'network' | 'error';

export type ChatState = {
  phase: 'consent' | 'ready' | 'sending';
  messages: ChatMessage[];
  notice: Notice | null;
  leadForm: 'closed' | 'open' | 'submitted';
  nextId: number;
};

export type ChatEvent =
  | { type: 'consent_given' }
  | { type: 'send_started'; text: string }
  | { type: 'send_succeeded'; reply: ApiReply }
  | { type: 'send_failed'; notice: Notice }
  | { type: 'lead_form_opened' }
  | { type: 'lead_form_closed' }
  | { type: 'lead_submitted' }
  | { type: 'new_chat' };

export function initialChatState(consentGiven: boolean): ChatState {
  return {
    phase: consentGiven ? 'ready' : 'consent',
    messages: [],
    notice: null,
    leadForm: 'closed',
    nextId: 1,
  };
}

export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'consent_given':
      return { ...state, phase: 'ready' };
    case 'send_started':
      if (state.phase !== 'ready') return state;
      return {
        ...state,
        phase: 'sending',
        notice: null,
        messages: [...state.messages, { id: state.nextId, role: 'user', text: event.text }],
        nextId: state.nextId + 1,
      };
    case 'send_succeeded': {
      const { reply } = event;
      return {
        ...state,
        phase: 'ready',
        messages: [
          ...state.messages,
          {
            id: state.nextId,
            role: 'bot',
            text: reply.text,
            citations: reply.citations,
            action: reply.action,
            ...(reply.contactUrl === undefined ? {} : { contactUrl: reply.contactUrl }),
          },
        ],
        nextId: state.nextId + 1,
      };
    }
    case 'send_failed':
      return { ...state, phase: 'ready', notice: event.notice };
    case 'lead_form_opened':
      return { ...state, leadForm: 'open' };
    case 'lead_form_closed':
      return { ...state, leadForm: 'closed' };
    case 'lead_submitted':
      return { ...state, leadForm: 'submitted' };
    case 'new_chat':
      return { ...initialChatState(true), nextId: state.nextId };
  }
}
