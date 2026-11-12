import { CAPABILITIES } from '@trainmore/core';
import { type ConversationDetail, FLAG_REASONS } from '@trainmore/db';
import { amsterdamDayBounds, isDay, maskText } from '@trainmore/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isFromPortal, type PortalDeps, requireAgent } from './auth.ts';

const flaggedQuery = z.object({
  reason: z.enum(FLAG_REASONS).optional(),
  days: z.coerce.number().int().min(1).max(90).default(7),
  page: z.coerce.number().int().min(0).max(1000).default(0),
  /** One Amsterdam calendar day (link from the daily report); overrides `days`. */
  day: z.string().refine(isDay).optional(),
});
const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const capabilityBody = z.object({ enabled: z.boolean() });

function masked(detail: ConversationDetail): ConversationDetail {
  return { ...detail, messages: detail.messages.map((m) => ({ ...m, text: maskText(m.text) })) };
}

/** Review of flagged conversations (masked by default) and the capability switches. */
export function registerPortalReviewRoutes(app: FastifyInstance, deps: PortalDeps): void {
  app.get('/portal/api/flagged', async (request, reply) => {
    const agent = await requireAgent(deps, request, reply);
    if (!agent) return reply;
    const query = flaggedQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request' });
    const window = query.data.day
      ? (({ start, end }) => ({ since: start, until: end }))(amsterdamDayBounds(query.data.day))
      : { since: new Date(Date.now() - query.data.days * 24 * 60 * 60 * 1000) };
    const conversations = await deps.repo.listFlagged({
      ...(query.data.reason ? { reason: query.data.reason } : {}),
      ...window,
      limit: PAGE_SIZE,
      offset: query.data.page * PAGE_SIZE,
    });
    return { conversations, pageSize: PAGE_SIZE };
  });

  app.get<{ Params: { id: string } }>('/portal/api/conversations/:id', async (request, reply) => {
    const agent = await requireAgent(deps, request, reply);
    if (!agent) return reply;
    const detail = UUID.test(request.params.id)
      ? await deps.repo.conversationDetail(request.params.id)
      : null;
    if (!detail) return reply.code(404).send({ error: 'not_found' });
    return masked(detail);
  });

  // The unmasked text: an explicit request from the portal, recorded in the audit log.
  app.post<{ Params: { id: string } }>(
    '/portal/api/conversations/:id/reveal',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const agent = await requireAgent(deps, request, reply);
      if (!agent) return reply;
      if (!isFromPortal(request, deps.config)) return reply.code(403).send({ error: 'forbidden' });
      const detail = UUID.test(request.params.id)
        ? await deps.repo.conversationDetail(request.params.id)
        : null;
      if (!detail) return reply.code(404).send({ error: 'not_found' });
      await deps.repo.audit({
        actor: { oid: agent.userOid, name: agent.displayName },
        action: 'conversation.reveal',
        entityType: 'conversation',
        entityId: detail.id,
      });
      return detail;
    },
  );

  app.get('/portal/api/capabilities', async (request, reply) => {
    const agent = await requireAgent(deps, request, reply);
    if (!agent) return reply;
    const flags = new Map((await deps.repo.listCapabilityFlags()).map((f) => [f.name, f.enabled]));
    return {
      capabilities: CAPABILITIES.map((c) => ({
        name: c.name,
        statuses: [...c.statuses],
        // No row means on (capability_flags).
        enabled: flags.get(c.name) ?? true,
      })),
    };
  });

  app.put<{ Params: { name: string } }>(
    '/portal/api/capabilities/:name',
    async (request, reply) => {
      const agent = await requireAgent(deps, request, reply, ['admin']);
      if (!agent) return reply;
      if (!isFromPortal(request, deps.config)) return reply.code(403).send({ error: 'forbidden' });
      if (!CAPABILITIES.some((c) => c.name === request.params.name)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const body = capabilityBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      await deps.repo.setCapability(request.params.name, body.data.enabled, {
        oid: agent.userOid,
        name: agent.displayName,
      });
      return reply.code(204).send();
    },
  );
}
