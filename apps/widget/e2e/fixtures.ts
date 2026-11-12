import type { Page, Route } from '@playwright/test';

export const CONVERSATION = {
  conversationId: '00000000-0000-4000-8000-000000000001',
  token: 't'.repeat(43),
};

type Reply = {
  text: string;
  lang: 'nl' | 'en';
  citations: { articleId: number; title: string; url: string }[];
  action: 'none' | 'lead_form' | 'ticket_form' | 'login';
  contactUrl?: string;
  messageId?: number;
};

export type MockApi = { requests: { path: string; body: unknown }[] };

/** Mocks the M1b API. `replies` are returned in order for message requests (a number = HTTP error status). */
export type MockAccount = {
  index: number;
  studioName: string;
  status: 'MEMBER' | 'PROSPECT' | 'FORMER_MEMBER';
  maskedNumber: string;
};

export async function mockApi(
  page: Page,
  replies: (Reply | number)[],
  leadStatus = 201,
  accounts: MockAccount[] = [
    { index: 0, studioName: 'TrainMore Amsterdam', status: 'MEMBER', maskedNumber: '•••004' },
  ],
  ticketStatus = 201,
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
    api.requests.push({ path, body: request.method() === 'GET' ? null : request.postDataJSON() });
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
    if (path.endsWith('/login/request'))
      return route.fulfill({ status: 202, headers: cors, json: { ok: true } });
    if (path.endsWith('/login/verify')) {
      const { code } = request.postDataJSON() as { code: string };
      return code === '123456'
        ? route.fulfill({
            status: 200,
            headers: cors,
            json: { accounts, selected: accounts.length === 1 ? 0 : null },
          })
        : route.fulfill({ status: 400, headers: cors, json: { error: 'invalid_code' } });
    }
    if (path.endsWith('/login/select')) {
      const { index } = request.postDataJSON() as { index: number };
      return route.fulfill({ status: 200, headers: cors, json: { account: accounts[index] } });
    }
    if (path === '/widget/ticket-topics') {
      const lang = new URL(request.url()).searchParams.get('lang');
      return route.fulfill({
        status: 200,
        headers: cors,
        json: {
          topics: [
            {
              value: 'Membership & contract',
              label: lang === 'nl' ? 'Lidmaatschap & contract' : 'Membership & contract',
            },
            {
              value: 'Payments & invoices',
              label: lang === 'nl' ? 'Betalingen & facturen' : 'Payments & invoices',
            },
          ],
        },
      });
    }
    if (path.endsWith('/feedback')) return route.fulfill({ status: 204, headers: cors });
    if (path.endsWith('/tickets')) {
      return route.fulfill({
        status: ticketStatus,
        headers: cors,
        json: ticketStatus === 201 ? { ok: true } : { error: 'verification_failed' },
      });
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
      body: `(() => {
        let issued = 0;
        let current;
        const next = () => setTimeout(() => current && current.callback(issued++ === 0 ? 'XXXX.DUMMY.TOKEN.XXXX' : 'XXXX.DUMMY.TOKEN.' + issued), 10);
        window.turnstile = {
          render(el, opts) { current = opts; next(); return 'w1'; },
          reset() { next(); },
          remove() { current = undefined; },
        };
      })();`,
    }),
  );
  return api;
}
