import { DbError, type ScenarioVersion } from '@trainmore/db';
import { maskText } from '@trainmore/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isFromPortal, type PortalDeps, requireAgent } from './auth.ts';

const trigger = z.string().trim().min(1).max(300);
const answer = z.string().trim().min(1).max(1200);
const contentSchema = z.object({
  triggersNl: z.array(trigger).min(1).max(10),
  triggersEn: z.array(trigger).min(1).max(10),
  answerNl: answer,
  answerEn: answer,
  statuses: z.array(z.enum(['MEMBER', 'PROSPECT', 'FORMER_MEMBER'])).max(3),
  articleId: z.number().int().positive().nullable(),
});
const replayBody = z.object({ versionId: z.number().int().positive() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLISH_STATUS = {
  ok: 204,
  not_found: 404,
  own_version: 403,
  archived: 409,
  not_publishable: 409,
} as const;

/** What the portal shows of a version (Entra object ids stay on the server). */
const publicVersion = ({ authorOid: _oid, ...version }: ScenarioVersion) => version;

/** Approved answers: drafts by anyone, publishing (four eyes) and archiving by approvers/admins. */
export function registerPortalScenarioRoutes(app: FastifyInstance, deps: PortalDeps): void {
  const approvers = ['approver', 'admin'] as const;
  const actorOf = (agent: { userOid: string; displayName: string }) => ({
    oid: agent.userOid,
    name: agent.displayName,
  });

  app.get('/portal/api/scenarios', async (request, reply) => {
    if (!(await requireAgent(deps, request, reply))) return reply;
    return { scenarios: await deps.scenarios.list() };
  });

  app.get<{ Params: { id: string } }>('/portal/api/scenarios/:id', async (request, reply) => {
    if (!(await requireAgent(deps, request, reply))) return reply;
    const scenario = UUID.test(request.params.id)
      ? await deps.scenarios.get(request.params.id)
      : null;
    if (!scenario) return reply.code(404).send({ error: 'not_found' });
    return { ...scenario, versions: scenario.versions.map(publicVersion) };
  });

  app.post('/portal/api/scenarios', async (request, reply) => {
    const agent = await requireAgent(deps, request, reply);
    if (!agent) return reply;
    if (!isFromPortal(request, deps.config)) return reply.code(403).send({ error: 'forbidden' });
    const body = contentSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(201).send(await deps.scenarios.create(body.data, actorOf(agent)));
  });

  app.post<{ Params: { id: string } }>(
    '/portal/api/scenarios/:id/versions',
    async (request, reply) => {
      const agent = await requireAgent(deps, request, reply);
      if (!agent) return reply;
      if (!isFromPortal(request, deps.config)) return reply.code(403).send({ error: 'forbidden' });
      const body = contentSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      if (!UUID.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
      try {
        const versionId = await deps.scenarios.addVersion(
          request.params.id,
          body.data,
          actorOf(agent),
        );
        return reply.code(201).send({ versionId });
      } catch (error) {
        // Unknown or archived scenario.
        if (
          (error instanceof DbError || error instanceof Error) &&
          (error as { code?: string }).code === 'P0002'
        ) {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/portal/api/scenario-versions/:id/publish',
    async (request, reply) => {
      const agent = await requireAgent(deps, request, reply, approvers);
      if (!agent) return reply;
      if (!isFromPortal(request, deps.config)) return reply.code(403).send({ error: 'forbidden' });
      const versionId = Number(request.params.id);
      if (!Number.isSafeInteger(versionId) || versionId <= 0) {
        return reply.code(404).send({ error: 'not_found' });
      }
      // Four eyes is enforced in SQL (publish_scenario_version), not only here.
      const result = await deps.scenarios.publish(versionId, actorOf(agent));
      if (result === 'ok') return reply.code(204).send();
      return reply
        .code(PUBLISH_STATUS[result as keyof typeof PUBLISH_STATUS])
        .send({ error: result });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/portal/api/scenarios/:id/archive',
    async (request, reply) => {
      const agent = await requireAgent(deps, request, reply, approvers);
      if (!agent) return reply;
      if (!isFromPortal(request, deps.config)) return reply.code(403).send({ error: 'forbidden' });
      const result = UUID.test(request.params.id)
        ? await deps.scenarios.archive(request.params.id, actorOf(agent))
        : 'not_found';
      return result === 'ok'
        ? reply.code(204).send()
        : reply.code(404).send({ error: 'not_found' });
    },
  );

  // Side-by-side test of a draft on a real conversation (mock Magicline only), audited.
  app.post<{ Params: { id: string } }>(
    '/portal/api/conversations/:id/replay',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const agent = await requireAgent(deps, request, reply);
      if (!agent) return reply;
      if (!isFromPortal(request, deps.config)) return reply.code(403).send({ error: 'forbidden' });
      if (!deps.replay) return reply.code(409).send({ error: 'replay_unavailable' });
      const body = replayBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      const conversation = UUID.test(request.params.id)
        ? await deps.repo.conversationDetail(request.params.id)
        : null;
      const version = await deps.scenarios.getVersion(body.data.versionId);
      if (!conversation || !version) return reply.code(404).send({ error: 'not_found' });

      // Each customer question with the bot's original answer to it.
      const turns = conversation.messages.flatMap((m, i) => {
        if (m.role !== 'user') return [];
        const next = conversation.messages[i + 1];
        return [{ question: m.text, oldAnswer: next?.role === 'assistant' ? next.text : null }];
      });
      const replies = await deps.replay({
        questions: turns.map((t) => t.question),
        pageLang: conversation.lang,
        status: conversation.customerStatus,
        draft: {
          versionId: version.id,
          scenarioId: version.scenarioId,
          triggers: conversation.lang === 'nl' ? version.triggersNl : version.triggersEn,
          answerNl: version.answerNl,
          answerEn: version.answerEn,
          statuses: version.statuses,
          articleId: version.articleId,
          article: null,
        },
      });
      await deps.repo.audit({
        actor: actorOf(agent),
        action: 'scenario.replay',
        entityType: 'conversation',
        entityId: conversation.id,
        details: { versionId: version.id, questions: replies.length },
      });
      return {
        results: replies.map((r, i) => ({
          question: maskText(r.question),
          oldAnswer:
            turns[i]?.oldAnswer === null || turns[i] === undefined
              ? null
              : maskText(turns[i].oldAnswer ?? ''),
          newAnswer: maskText(r.reply.text),
          usesDraft: r.reply.scenarioVersionId === version.id,
          outcome: r.reply.outcome,
          action: r.reply.action,
        })),
      };
    },
  );
}
