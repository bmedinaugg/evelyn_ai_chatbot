import { beforeEach, describe, expect, it } from 'vitest';
import { createPortalApi, PortalApiError } from '../src/lib/api.ts';

let requests: Request[];
let responses: Response[];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const api = createPortalApi({
  fetch: async (input, init) => {
    requests.push(new Request(new URL(String(input), 'https://portal.test'), init));
    const next = responses.shift();
    if (!next) throw new Error('no queued response');
    return next;
  },
});

beforeEach(() => {
  requests = [];
  responses = [];
});

describe('createPortalApi', () => {
  it('reads the signed-in agent', async () => {
    responses.push(json(200, { name: 'Agent One', roles: ['agent'] }));
    expect(await api.me()).toEqual({ name: 'Agent One', roles: ['agent'] });
    expect(requests[0]?.url).toBe('https://portal.test/portal/api/me');
  });

  it('maps 401 and 403 to typed errors', async () => {
    responses.push(json(401, { error: 'unauthorized' }), json(403, { error: 'forbidden' }));
    await expect(api.me()).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(api.me()).rejects.toBeInstanceOf(PortalApiError);
  });

  it('lists flagged conversations with filters', async () => {
    responses.push(json(200, { conversations: [], pageSize: 50 }));
    await api.flagged({ reason: 'thumbs_down', days: 7, page: 1 });
    expect(requests[0]?.url).toBe(
      'https://portal.test/portal/api/flagged?days=7&page=1&reason=thumbs_down',
    );
  });

  it('switches a capability with PUT', async () => {
    responses.push(new Response(null, { status: 204 }));
    await api.setCapability('get_recent_visits', false);
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe('https://portal.test/portal/api/capabilities/get_recent_visits');
    expect(await requests[0]?.json()).toEqual({ enabled: false });
  });

  it('rejects an unexpected response shape', async () => {
    responses.push(json(200, { name: 1 }));
    await expect(api.me()).rejects.toMatchObject({ kind: 'server' });
  });

  it('publishes a version and reports the four-eyes refusal', async () => {
    responses.push(new Response(null, { status: 204 }), json(403, { error: 'own_version' }));
    expect(await api.publish(4)).toBe('ok');
    expect(requests[0]?.url).toBe('https://portal.test/portal/api/scenario-versions/4/publish');
    expect(await api.publish(4)).toBe('own_version');
  });

  it('drafts an approved answer and replays a conversation with it', async () => {
    responses.push(json(201, { scenarioId: 's1', versionId: 9 }));
    const content = {
      triggersNl: ['Hond?'],
      triggersEn: ['Dog?'],
      answerNl: 'Nee.',
      answerEn: 'No.',
      statuses: [],
      articleId: null,
    };
    expect(await api.createScenario(content)).toEqual({ scenarioId: 's1', versionId: 9 });
    expect(await requests[0]?.json()).toEqual(content);
    responses.push(
      json(200, {
        results: [
          {
            question: 'Hond?',
            oldAnswer: null,
            newAnswer: 'Nee.',
            usesDraft: true,
            outcome: 'answered',
            action: 'none',
          },
        ],
        judgement: {
          verdicts: [{ verdict: 'better', reason: 'Beantwoordt de vraag.' }],
          summary: { better: 1, same: 0, worse: 0 },
        },
      }),
    );
    const replay = await api.replay('c1', 9, 'nl');
    expect(replay.results[0]?.usesDraft).toBe(true);
    expect(replay.judgement?.summary.better).toBe(1);
    expect(requests[1]?.url).toBe('https://portal.test/portal/api/conversations/c1/replay');
    expect(await requests[1]?.json()).toEqual({ versionId: 9, lang: 'nl' });
  });

  it('reads metrics for a range, a report day, and flagged conversations of one day', async () => {
    const day = {
      day: '2026-11-12',
      conversations: 10,
      resolved: 6,
      escalations: 1,
      thumbsUp: 2,
      thumbsDown: 1,
      approvedAnswers: 1,
      logins: 3,
      flags: { no_match: 2 },
    };
    const { day: _d, ...totals } = day;
    responses.push(json(200, { from: '2026-11-12', to: '2026-11-12', days: [day], totals }));
    expect((await api.metrics('2026-11-12', '2026-11-12')).totals.resolved).toBe(6);
    expect(requests[0]?.url).toBe(
      'https://portal.test/portal/api/metrics?from=2026-11-12&to=2026-11-12',
    );

    responses.push(
      json(200, {
        day: '2026-11-12',
        sentAt: null,
        recipientsCount: 2,
        clustered: true,
        topics: [{ labelNl: 'Sauna', labelEn: 'Sauna', count: 2, conversationIds: [] }],
      }),
      json(404, { error: 'not_found' }),
    );
    expect((await api.report('2026-11-12'))?.topics).toHaveLength(1);
    expect(await api.report('2026-11-11')).toBeNull();

    responses.push(json(200, { conversations: [], pageSize: 50 }));
    await api.flagged({ day: '2026-11-12', days: 7, page: 0 });
    expect(requests[3]?.url).toBe(
      'https://portal.test/portal/api/flagged?days=7&page=0&day=2026-11-12',
    );
  });
});
