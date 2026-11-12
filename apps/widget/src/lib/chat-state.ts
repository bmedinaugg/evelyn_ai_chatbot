import type { ApiReply } from './api.ts';
import type { ReplyAction } from './types.ts';

export type ChatMessage =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'note'; text: string }
  | {
      id: number;
      role: 'bot';
      text: string;
      citations: ApiReply['citations'];
      action: ReplyAction;
      contactUrl?: string;
      /** Stored reply id (thumbs up/down are only offered when present). */
      messageId?: number;
      rating?: 'up' | 'down';
    };

export type Notice = 'busy' | 'rate_limited' | 'network' | 'error';

export type ChatState = {
  phase: 'consent' | 'ready' | 'sending';
  messages: ChatMessage[];
  notice: Notice | null;
  leadForm: 'closed' | 'open' | 'submitted';
  ticketForm: 'closed' | 'open' | 'submitted';
  loginForm: 'closed' | 'open';
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
  | { type: 'ticket_form_opened' }
  | { type: 'ticket_form_closed' }
  | { type: 'ticket_submitted' }
  | { type: 'login_opened' }
  | { type: 'login_closed' }
  | { type: 'logged_in'; note: string }
  | { type: 'feedback_given'; id: number; rating: 'up' | 'down' | undefined }
  | { type: 'new_chat' };

export function initialChatState(consentGiven: boolean): ChatState {
  return {
    phase: consentGiven ? 'ready' : 'consent',
    messages: [],
    notice: null,
    leadForm: 'closed',
    ticketForm: 'closed',
    loginForm: 'closed',
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
            ...(reply.messageId === undefined ? {} : { messageId: reply.messageId }),
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
    case 'ticket_form_opened':
      return { ...state, ticketForm: 'open' };
    case 'ticket_form_closed':
      return { ...state, ticketForm: 'closed' };
    case 'ticket_submitted':
      return { ...state, ticketForm: 'submitted' };
    case 'login_opened':
      return { ...state, loginForm: 'open' };
    case 'login_closed':
      return { ...state, loginForm: 'closed' };
    case 'logged_in':
      return {
        ...state,
        loginForm: 'closed',
        messages: [...state.messages, { id: state.nextId, role: 'note', text: event.note }],
        nextId: state.nextId + 1,
      };
    case 'feedback_given':
      return {
        ...state,
        messages: state.messages.map((message) => {
          if (message.id !== event.id || message.role !== 'bot') return message;
          const { rating: _previous, ...rest } = message;
          return event.rating === undefined ? rest : { ...rest, rating: event.rating };
        }),
      };
    case 'new_chat':
      return { ...initialChatState(true), nextId: state.nextId };
  }
}

const SUBJECT_MAX = 100;
const DESCRIPTION_MAX = 5000;

/** Ticket form prefill from what the customer typed: first question as subject, all as description. */
export function ticketPrefill(messages: ChatMessage[]): { subject: string; description: string } {
  const questions = messages.flatMap((m) => (m.role === 'user' ? [m.text.trim()] : []));
  return {
    subject: (questions[0] ?? '').replace(/\s+/g, ' ').slice(0, SUBJECT_MAX),
    description: questions.join('\n\n').slice(0, DESCRIPTION_MAX),
  };
}
