import type { Page, Route } from '@playwright/test';

export const CONV = '00000000-0000-4000-8000-000000000001';

export type MockPortal = { requests: { method: string; path: string; body: unknown }[] };

/** Mocks /portal/api and /portal/auth/logout. `me`: the signed-in agent, or an HTTP status. */
export async function mockPortal(
  page: Page,
  me: { name: string; roles: string[] } | 401 | 403,
): Promise<MockPortal> {
  const api: MockPortal = { requests: [] };
  const capabilities = [
    { name: 'get_memberships', statuses: ['MEMBER', 'FORMER_MEMBER'], enabled: true },
    { name: 'get_recent_visits', statuses: ['MEMBER'], enabled: true },
  ];
  let signedIn = true;
  const conversation = (text: string) => ({
    id: CONV,
    lang: 'nl',
    createdAt: '2026-11-12T09:00:00Z',
    loggedIn: true,
    messages: [
      {
        id: 1,
        role: 'user',
        text,
        outcome: null,
        citations: [],
        createdAt: '2026-11-12T09:00:00Z',
        rating: null,
      },
      {
        id: 2,
        role: 'assistant',
        text: 'Ik kon hier geen betrouwbaar antwoord op vinden.',
        outcome: 'no_match',
        citations: [],
        createdAt: '2026-11-12T09:00:01Z',
        rating: 'down',
      },
    ],
    flags: [{ reason: 'no_match', createdAt: '2026-11-12T09:00:01Z' }],
    escalations: [{ topic: 'Payments', reason: 'stuck', createdAt: '2026-11-12T09:01:00Z' }],
  });

  await page.route('**/portal/api/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    api.requests.push({ method: request.method(), path, body: request.postDataJSON() });
    if (path === '/portal/api/me') {
      if (!signedIn || me === 401)
        return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      if (me === 403) return route.fulfill({ status: 403, json: { error: 'forbidden' } });
      return route.fulfill({ json: me });
    }
    if (path === '/portal/api/flagged') {
      return route.fulfill({
        json: {
          pageSize: 50,
          conversations: [
            {
              conversationId: CONV,
              lang: 'nl',
              lastFlagAt: '2026-11-12T10:00:00Z',
              userMessageCount: 2,
              reasons: ['no_match', 'thumbs_down'],
              escalated: true,
              loggedIn: true,
            },
          ],
        },
      });
    }
    if (path === `/portal/api/conversations/${CONV}`) {
      return route.fulfill({ json: conversation('Mail me op [•••]') });
    }
    if (path === `/portal/api/conversations/${CONV}/reveal`) {
      return route.fulfill({ json: conversation('Mail me op sam@example.com') });
    }
    if (path === '/portal/api/capabilities') return route.fulfill({ json: { capabilities } });
    if (path.startsWith('/portal/api/capabilities/') && request.method() === 'PUT') {
      const name = path.split('/').at(-1);
      const target = capabilities.find((c) => c.name === name);
      if (target) target.enabled = (request.postDataJSON() as { enabled: boolean }).enabled;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.route('**/portal/auth/logout', async (route) => {
    api.requests.push({
      method: route.request().method(),
      path: '/portal/auth/logout',
      body: null,
    });
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
  return api;
}
