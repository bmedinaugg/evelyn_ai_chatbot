import { buildTicketNote, hashEmail } from '@trainmore/core';
import type { EscalationReason, Outcome } from '@trainmore/db';
import { type Lang, t } from '@trainmore/i18n';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeConversation } from './authorize.ts';
import type { ApiDeps } from './server.ts';

/** Built-in topics (Freshdesk ticket type values) with nl/en labels; used until a sync ran. */
const BUILT_IN_TOPICS = {
  'Membership & contract': 'ticket.topics.membership',
  'Payments & invoices': 'ticket.topics.payments',
  'Club & facilities': 'ticket.topics.club',
  'App & account': 'ticket.topics.app',
} as const;

const STUCK_OUTCOMES: ReadonlySet<Outcome> = new Set(['no_match', 'invalid_citation']);

const langSchema = z.enum(['nl', 'en']);

const ticketBody = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  name: z.string().trim().min(1).max(100).optional(),
  topic: z.string().max(255),
  subject: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(5000),
  lang: langSchema,
  turnstileToken: z.string().max(4096),
  consent: z.literal(true),
});

function label(lang: Lang, value: string): string {
  const key = BUILT_IN_TOPICS[value as keyof typeof BUILT_IN_TOPICS];
  return key ? t(lang, key) : value;
}

/**
 * Synced topics, or the built-in ones when none are synced or the database is unavailable.
 * Only synced topics are known Freshdesk ticket types (Freshdesk rejects an unknown type).
 */
async function offeredTopics(deps: ApiDeps): Promise<{ values: string[]; synced: boolean }> {
  try {
    const synced = await deps.escalations.activeTopics();
    if (synced.length > 0) return { values: synced, synced: true };
  } catch (error) {
    deps.logger.error({ err: error }, 'ticket topics unavailable; using built-in topics');
  }
  return { values: Object.keys(BUILT_IN_TOPICS), synced: false };
}

/**
 * General ticket form (hand-off to support). The ticket carries what the customer typed; a private
 * note adds the transcript of this conversation and, only for the verified email, status and club.
 * Nothing the customer typed in the form is stored or logged here.
 */
export function registerTicketRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: { lang?: string } }>(
    '/widget/ticket-topics',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const lang = langSchema.safeParse(request.query.lang);
      if (!lang.success) return reply.code(400).send({ error: 'invalid_request' });
      const topics = (await offeredTopics(deps)).values;
      return { topics: topics.map((value) => ({ value, label: label(lang.data, value) })) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/widget/conversations/:id/tickets',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const conversation = await authorizeConversation(deps.conversations, request, reply);
      if (!conversation) return reply;
      const parsed = ticketBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      const body = parsed.data;
      const topics = await offeredTopics(deps);
      if (!topics.values.includes(body.topic)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!(await deps.verifyTurnstile(body.turnstileToken, request.ip))) {
        return reply.code(400).send({ error: 'verification_failed' });
      }

      let ticketId: number;
      try {
        const ticket = await deps.freshdesk.createTicket({
          email: body.email,
          ...(body.name === undefined ? {} : { name: body.name }),
          subject: body.subject,
          descriptionText: body.description,
          tags: ['chatbot', 'escalation', body.lang],
          ...(topics.synced ? { type: body.topic } : {}),
        });
        ticketId = ticket.id;
      } catch (error) {
        deps.logger.error(
          { err: error, conversationId: conversation.id },
          'ticket creation failed',
        );
        return reply.code(502).send({ error: 'unavailable' });
      }

      // The ticket exists now: never fail the request (the customer would resubmit and duplicate it).
      let reason: EscalationReason = 'customer_request';
      try {
        const [transcript, auth, lastOutcome] = await Promise.all([
          deps.conversations.listTranscript(conversation.id),
          deps.login.auth.getAuthState(conversation.id),
          deps.conversations.lastAssistantOutcome(conversation.id),
        ]);
        if (lastOutcome !== null && STUCK_OUTCOMES.has(lastOutcome)) reason = 'stuck';
        // Account context only for the email that was verified with a code in this conversation.
        const sameEmail =
          auth.verifiedEmailHash !== null &&
          auth.verifiedEmailHash === hashEmail(deps.login.config.secret, body.email);
        const candidate =
          sameEmail && auth.account
            ? auth.candidates?.find(
                (c) =>
                  c.customerId === auth.account?.customerId && c.studioId === auth.account.studioId,
              )
            : undefined;
        const note = buildTicketNote({
          lang: body.lang,
          transcript,
          topic: body.topic,
          account:
            auth.account && candidate
              ? { status: auth.account.status, clubName: candidate.studioName }
              : null,
        });
        await deps.freshdesk.addPrivateNote(ticketId, note);
      } catch (error) {
        deps.logger.warn(
          { err: error, conversationId: conversation.id, freshdeskTicketId: ticketId },
          'ticket note failed',
        );
      }

      try {
        await deps.escalations.record({
          conversationId: conversation.id,
          freshdeskTicketId: ticketId,
          topic: body.topic,
          reason,
        });
      } catch (error) {
        deps.logger.error(
          { err: error, conversationId: conversation.id, freshdeskTicketId: ticketId },
          'recording escalation failed',
        );
      }
      deps.logger.info(
        { conversationId: conversation.id, freshdeskTicketId: ticketId, reason },
        'ticket submitted',
      );
      return reply.code(201).send({ ok: true });
    },
  );
}
