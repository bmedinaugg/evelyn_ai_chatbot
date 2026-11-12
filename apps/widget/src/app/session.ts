import type { Session } from '../lib/api.ts';

// Per browser tab, on the widget's own origin. Storage can be unavailable (private mode, blocked).
const KEY = 'trainmore-chat';

/**
 * verifiedEmail: the email verified with a login code for this session, to prefill the forms after
 * a reload. Same scope as the session token (this tab, widget origin); cleared with the session.
 */
type Stored = { session: Session | null; consentGiven: boolean; verifiedEmail: string | null };

export function loadStored(): Stored {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { session: null, consentGiven: false, verifiedEmail: null };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const session =
      parsed.session &&
      typeof parsed.session.conversationId === 'string' &&
      typeof parsed.session.token === 'string'
        ? parsed.session
        : null;
    return {
      session,
      consentGiven: parsed.consentGiven === true,
      verifiedEmail:
        session && typeof parsed.verifiedEmail === 'string' ? parsed.verifiedEmail : null,
    };
  } catch {
    return { session: null, consentGiven: false, verifiedEmail: null };
  }
}

export function saveStored(stored: Stored): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Without storage the chat still works for this page view.
  }
}
