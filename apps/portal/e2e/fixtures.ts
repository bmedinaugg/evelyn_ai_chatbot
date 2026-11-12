import type { Page, Route } from '@playwright/test';

export const CONV = '00000000-0000-4000-8000-000000000001';

export type MockPortal = {
  requests: { method: string; path: string; body: unknown; query?: string }[];
};

/** Mocks /portal/api and /portal/auth/logout. `me`: the signed-in agent, or an HTTP status. */
type Version = {
  id: number;
  version: number;
  status: 'draft' | 'published' | 'superseded' | 'withdrawn';
  triggersNl: string[];
  triggersEn: string[];
  answerNl: string;
  answerEn: string;
  statuses: string[];
  articleId: number | null;
  authorName: string;
  createdAt: string;
  publishedByName: string | null;
  publishedAt: string | null;
};

export const SCENARIO = '00000000-0000-4000-8000-00000000000a';

export async function mockPortal(
  page: Page,
  me: { name: string; roles: string[] } | 401 | 403,
  options: { replayAvailable?: boolean } = {},
): Promise<MockPortal> {
  const api: MockPortal = { requests: [] };
  const capabilities = [
    { name: 'get_memberships', statuses: ['MEMBER', 'FORMER_MEMBER'], enabled: true },
    { name: 'get_recent_visits', statuses: ['MEMBER'], enabled: true },
  ];
  let signedIn = true;
  const myName = typeof me === 'object' ? me.name : '';
  const isApprover =
    typeof me === 'object' && me.roles.some((r) => r === 'approver' || r === 'admin');
  let archived = false;
  const versions: Version[] = [
    {
      id: 1,
      version: 1,
      status: 'published',
      triggersNl: ['Mag mijn hond mee?'],
      triggersEn: ['Can I bring my dog?'],
      answerNl: 'Huisdieren zijn niet toegestaan.',
      answerEn: 'Pets are not allowed.',
      statuses: [],
      articleId: null,
      authorName: 'Someone Else',
      createdAt: '2026-11-12T09:00:00Z',
      publishedByName: 'Approver',
      publishedAt: '2026-11-12T09:30:00Z',
    },
    {
      id: 2,
      version: 2,
      status: 'draft',
      triggersNl: ['Mag mijn hond mee?'],
      triggersEn: ['Can I bring my dog?'],
      answerNl: 'Alleen hulphonden zijn toegestaan.',
      answerEn: 'Only assistance dogs are allowed.',
      statuses: [],
      articleId: null,
      authorName: 'Someone Else',
      createdAt: '2026-11-12T10:00:00Z',
      publishedByName: null,
      publishedAt: null,
    },
  ];
  const summary = () => ({
    id: SCENARIO,
    createdAt: '2026-11-12T09:00:00Z',
    archived,
    latestVersion: versions.length,
    latestVersionId: versions.at(-1)?.id ?? 0,
    publishedVersion: versions.find((v) => v.status === 'published')?.version ?? null,
    firstTriggerNl: versions.at(-1)?.triggersNl[0] ?? '',
    firstTriggerEn: versions.at(-1)?.triggersEn[0] ?? '',
  });
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
    api.requests.push({
      method: request.method(),
      path,
      body: request.postDataJSON(),
      query: new URL(request.url()).search,
    });
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
    if (path === '/portal/api/scenarios' && request.method() === 'GET') {
      return route.fulfill({ json: { scenarios: [summary()] } });
    }
    if (path === '/portal/api/scenarios' && request.method() === 'POST') {
      const body = request.postDataJSON() as Omit<Version, 'id' | 'version' | 'status'>;
      versions.push({
        ...body,
        id: versions.length + 1,
        version: versions.length + 1,
        status: 'draft',
        authorName: myName,
        createdAt: '2026-11-12T11:00:00Z',
        publishedByName: null,
        publishedAt: null,
      });
      return route.fulfill({
        status: 201,
        json: { scenarioId: SCENARIO, versionId: versions.length },
      });
    }
    if (path === `/portal/api/scenarios/${SCENARIO}` && request.method() === 'GET') {
      return route.fulfill({ json: { id: SCENARIO, archived, versions } });
    }
    if (path === `/portal/api/scenarios/${SCENARIO}/archive`) {
      if (!isApprover) return route.fulfill({ status: 403, json: { error: 'forbidden' } });
      archived = true;
      return route.fulfill({ status: 204 });
    }
    const publish = /^\/portal\/api\/scenario-versions\/(\d+)\/publish$/.exec(path);
    if (publish) {
      const target = versions.find((v) => v.id === Number(publish[1]));
      if (!isApprover) return route.fulfill({ status: 403, json: { error: 'forbidden' } });
      if (!target) return route.fulfill({ status: 404, json: { error: 'not_found' } });
      if (target.authorName === myName)
        return route.fulfill({ status: 403, json: { error: 'own_version' } });
      for (const v of versions) if (v.status === 'published') v.status = 'superseded';
      target.status = 'published';
      target.publishedByName = myName;
      return route.fulfill({ status: 204 });
    }
    if (path === `/portal/api/conversations/${CONV}/replay`) {
      if (options.replayAvailable === false) {
        return route.fulfill({ status: 409, json: { error: 'replay_unavailable' } });
      }
      return route.fulfill({
        json: {
          results: [
            {
              question: 'Mail me op [•••]',
              oldAnswer: 'Ik kon hier geen betrouwbaar antwoord op vinden.',
              newAnswer: 'Alleen hulphonden zijn toegestaan.',
              usesDraft: true,
              outcome: 'answered',
              action: 'none',
            },
          ],
          judgement: {
            verdicts: [{ verdict: 'better', reason: 'Beantwoordt de vraag nu wel.' }],
            summary: { better: 1, same: 0, worse: 0 },
          },
        },
      });
    }
    if (path === '/portal/api/metrics') {
      const url = new URL(request.url());
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      const days: Record<string, unknown>[] = [];
      for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); ) {
        days.push({
          day: d.toISOString().slice(0, 10),
          conversations: 10,
          resolved: 6,
          escalations: 1,
          thumbsUp: 3,
          thumbsDown: 1,
          approvedAnswers: 1,
          logins: 2,
          flags: { no_match: 2 },
        });
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const n = days.length;
      return route.fulfill({
        json: {
          from,
          to,
          days,
          totals: {
            conversations: 10 * n,
            resolved: 6 * n,
            escalations: n,
            thumbsUp: 3 * n,
            thumbsDown: n,
            approvedAnswers: n,
            logins: 2 * n,
            flags: { no_match: 2 * n },
          },
        },
      });
    }
    if (path.startsWith('/portal/api/reports/')) {
      return route.fulfill({
        json: {
          day: path.split('/').at(-1),
          sentAt: '2026-11-13T06:00:00Z',
          recipientsCount: 2,
          clustered: true,
          topics: [
            {
              labelNl: 'Bevriezen bij zwangerschap',
              labelEn: 'Freezing when pregnant',
              count: 4,
              conversationIds: [CONV],
            },
          ],
        },
      });
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
