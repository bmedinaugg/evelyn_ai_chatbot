import type { Session } from '../lib/api.ts';

// Per browser tab, on the widget's own origin. Storage can be unavailable (private mode, blocked).
const KEY = 'trainmore-chat';

type Stored = { session: Session | null; consentGiven: boolean };

export function loadStored(): Stored {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { session: null, consentGiven: false };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const session = parsed.session;
    return {
      session:
        session && typeof session.conversationId === 'string' && typeof session.token === 'string'
          ? session
          : null,
      consentGiven: parsed.consentGiven === true,
    };
  } catch {
    return { session: null, consentGiven: false };
  }
}

export function saveStored(stored: Stored): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Without storage the chat still works for this page view.
  }
}
