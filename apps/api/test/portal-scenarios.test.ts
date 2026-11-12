import { describe, expect, it } from 'vitest';
import { createTestApi, PORTAL_ORIGIN, portalLogin } from './helpers.ts';

type Api = ReturnType<typeof createTestApi>;
const CONV = '00000000-0000-4000-8000-000000000001';

const content = {
  triggersNl: ['Mag mijn hond mee?'],
  triggersEn: ['Can I bring my dog?'],
  answerNl: 'Huisdieren zijn niet toegestaan.',
  answerEn: 'Pets are not allowed.',
  statuses: [],
  articleId: null,
};

function call(
  api: Api,
  method: 'GET' | 'POST',
  url: string,
  session: string,
  payload?: unknown,
  origin = PORTAL_ORIGIN,
) {
  return api.app.inject({
    method,
    url,
    headers: { cookie: `tm_portal=${session}`, origin },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** An author (agent) and an approver signed in to the same server. */
async function authorAndApprover(approverRoles = ['approver']) {
  const api = createTestApi({
    portal: { claims: { roles: ['agent'], oid: 'oid-author', name: 'Author' } },
  });
  const author = await portalLogin(api);
  api.setPortalClaims({ roles: approverRoles, oid: 'oid-approver', name: 'Approver' });
  const approver = await portalLogin(api);
  return { api, author, approver };
}

describe('portal approved answers', () => {
  it('any signed-in agent drafts an approved answer; the text is validated', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    const res = await call(api, 'POST', '/portal/api/scenarios', session, content);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ scenarioId: expect.any(String), versionId: 1 });
    for (const bad of [
      { ...content, triggersNl: [] },
      { ...content, answerNl: 'x'.repeat(1201) },
      { ...content, statuses: ['VIP'] },
      { ...content, answerEn: '' },
    ]) {
      expect((await call(api, 'POST', '/portal/api/scenarios', session, bad)).statusCode).toBe(400);
    }
    expect(
      (await call(api, 'POST', '/portal/api/scenarios', session, content, 'https://evil.example'))
        .statusCode,
    ).toBe(403);
    const list = await call(api, 'GET', '/portal/api/scenarios', session);
    expect(list.json().scenarios).toHaveLength(1);
  });

  it('agents cannot publish, and nobody publishes their own version', async () => {
    const { api, author, approver } = await authorAndApprover();
    const { versionId } = (
      await call(api, 'POST', '/portal/api/scenarios', approver, content)
    ).json();
    const own = await call(
      api,
      'POST',
      `/portal/api/scenario-versions/${versionId}/publish`,
      approver,
    );
    expect(own.statusCode).toBe(403);
    expect(own.json()).toEqual({ error: 'own_version' });
    expect(
      (await call(api, 'POST', `/portal/api/scenario-versions/${versionId}/publish`, author))
        .statusCode,
    ).toBe(403);
    expect(api.scenarioVersions[0]?.status).toBe('draft');
  });

  it('a second person publishes, with an audit row; versions are listed with their state', async () => {
    const { api, author, approver } = await authorAndApprover();
    const { scenarioId, versionId } = (
      await call(api, 'POST', '/portal/api/scenarios', author, content)
    ).json();
    expect(
      (await call(api, 'POST', `/portal/api/scenario-versions/${versionId}/publish`, approver))
        .statusCode,
    ).toBe(204);
    expect(api.audits).toContainEqual(
      expect.objectContaining({ action: 'scenario.publish', entityId: scenarioId }),
    );

    const v2 = await call(api, 'POST', `/portal/api/scenarios/${scenarioId}/versions`, author, {
      ...content,
      answerNl: 'Nee, alleen hulphonden.',
    });
    expect(v2.statusCode).toBe(201);
    const detail = (await call(api, 'GET', `/portal/api/scenarios/${scenarioId}`, author)).json();
    expect(
      detail.versions.map((v: { version: number; status: string }) => [v.version, v.status]),
    ).toEqual([
      [1, 'published'],
      [2, 'draft'],
    ]);
    expect(detail.versions[0]).not.toHaveProperty('authorOid');
  });

  it('approvers archive; a new version of an archived scenario is refused', async () => {
    const { api, author, approver } = await authorAndApprover();
    const { scenarioId } = (
      await call(api, 'POST', '/portal/api/scenarios', author, content)
    ).json();
    expect(
      (await call(api, 'POST', `/portal/api/scenarios/${scenarioId}/archive`, author)).statusCode,
    ).toBe(403);
    expect(
      (await call(api, 'POST', `/portal/api/scenarios/${scenarioId}/archive`, approver)).statusCode,
    ).toBe(204);
    expect(
      (await call(api, 'POST', `/portal/api/scenarios/${scenarioId}/versions`, author, content))
        .statusCode,
    ).toBe(404);
  });

  it('replays a conversation with a draft: old and new answers side by side, masked, audited', async () => {
    const api = createTestApi({ portal: {} });
    const session = await portalLogin(api);
    const { versionId } = (
      await call(api, 'POST', '/portal/api/scenarios', session, content)
    ).json();
    const res = await call(api, 'POST', `/portal/api/conversations/${CONV}/replay`, session, {
      versionId,
    });
    expect(res.statusCode).toBe(200);
    const [first] = res.json().results;
    expect(first.question).toBe('Ik ben Sam, mail [•••] of bel [•••]');
    expect(first.oldAnswer).toBe('Ik kon hier geen antwoord op vinden.');
    expect(first.newAnswer).toBe('Nieuw antwoord op: Ik ben Sam, mail [•••] of bel [•••]');
    expect(first.usesDraft).toBe(true);
    expect(res.body).not.toContain('sam@example.com');
    // The model got the original question, as the stored conversation had it; status for the test profile.
    expect(api.replayCalls[0]).toMatchObject({
      questions: ['Ik ben Sam, mail sam@example.com of bel 0612345678'],
      status: 'MEMBER',
      draft: { versionId },
    });
    expect(api.audits).toContainEqual(
      expect.objectContaining({ action: 'scenario.replay', entityId: CONV }),
    );
  });

  it('refuses a replay where Magicline is not the mock, or from another origin', async () => {
    const api = createTestApi({ portal: { replayAvailable: false } });
    const session = await portalLogin(api);
    const { versionId } = (
      await call(api, 'POST', '/portal/api/scenarios', session, content)
    ).json();
    const res = await call(api, 'POST', `/portal/api/conversations/${CONV}/replay`, session, {
      versionId,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'replay_unavailable' });

    const ok = createTestApi({ portal: {} });
    const s2 = await portalLogin(ok);
    expect(
      (
        await call(
          ok,
          'POST',
          `/portal/api/conversations/${CONV}/replay`,
          s2,
          { versionId: 1 },
          'https://evil.example',
        )
      ).statusCode,
    ).toBe(403);
  });
});
