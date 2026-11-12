import type { Page, Route } from '@playwright/test';

export const CONVERSATION = {
  conversationId: '00000000-0000-4000-8000-000000000001',
  token: 't'.repeat(43),
};

type Reply = {
  text: string;
  lang: 'nl' | 'en';
  citations: { articleId: number; title: string; url: string }[];
  action: 'none' | 'lead_form' | 'contact';
  contactUrl?: string;
};

export type MockApi = { requests: { path: string; body: unknown }[] };

/** Mocks the M1b API. `replies` are returned in order for message requests (a number = HTTP error status). */
export async function mockApi(
  page: Page,
  replies: (Reply | number)[],
  leadStatus = 201,
): Promise<MockApi> {
  const api: MockApi = { requests: [] };
  let conversations = 0;
  await page.route('https://api.test/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    api.requests.push({ path, body: request.postDataJSON() });
    if (path === '/widget/conversations') {
      conversations += 1;
      return route.fulfill({
        status: 201,
        headers: cors,
        json: {
          ...CONVERSATION,
          conversationId: CONVERSATION.conversationId.replace(/1$/, String(conversations)),
        },
      });
    }
    if (path.endsWith('/messages')) {
      const next = replies.shift();
      if (typeof next === 'number')
        return route.fulfill({ status: next, headers: cors, json: { error: 'x' } });
      return route.fulfill({ status: 200, headers: cors, json: { reply: next } });
    }
    if (path === '/widget/leads') {
      return route.fulfill({
        status: leadStatus,
        headers: cors,
        json: leadStatus === 201 ? { ok: true } : { error: 'verification_failed' },
      });
    }
    return route.fulfill({ status: 404, headers: cors, json: { error: 'not_found' } });
  });
  // Stand-in for Cloudflare Turnstile: renders nothing and hands back the documented dummy token.
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render(el, opts) { setTimeout(() => opts.callback('XXXX.DUMMY.TOKEN.XXXX'), 10); return 'w1'; }, reset() {}, remove() {} };`,
    }),
  );
  return api;
}
