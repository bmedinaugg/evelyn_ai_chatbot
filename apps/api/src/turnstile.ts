import { z } from 'zod';

// docs/api/turnstile.md
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;

const siteverifyResponse = z.object({ success: z.boolean() });

/** Verifies a Turnstile token server-side. Never throws: any failure counts as "not verified". */
export function createTurnstileVerifier(opts: {
  secretKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): (token: string, remoteIp: string) => Promise<boolean> {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return async (token, remoteIp) => {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
    try {
      const response = await doFetch(SITEVERIFY_URL, {
        method: 'POST',
        body: new URLSearchParams({ secret: opts.secretKey, response: token, remoteip: remoteIp }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return false;
      const parsed = siteverifyResponse.safeParse(await response.json());
      return parsed.success && parsed.data.success;
    } catch {
      return false;
    }
  };
}
