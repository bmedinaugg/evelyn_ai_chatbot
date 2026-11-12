import { t } from '@trainmore/i18n';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiDeps } from './server.ts';

const leadBody = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,20}$/)
    .optional(),
  question: z.string().trim().min(1).max(2000),
  lang: z.enum(['nl', 'en']),
  conversationId: z.uuid().optional(),
  turnstileToken: z.string().max(4096),
  consent: z.literal(true),
});

/** Sales lead form: Turnstile first, then a Freshdesk ticket. No personal data is stored or logged here. */
export function registerLeadRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.post(
    '/widget/leads',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = leadBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      const body = parsed.data;

      if (!(await deps.verifyTurnstile(body.turnstileToken, request.ip))) {
        return reply.code(400).send({ error: 'verification_failed' });
      }

      let ticketId: number;
      try {
        const ticket = await deps.freshdesk.createTicket({
          email: body.email,
          ...(body.phone === undefined ? {} : { phone: body.phone }),
          subject: t(body.lang, 'lead.subject'),
          descriptionText: `${body.question}\n\n—\nSource: website chat (lead form)`,
          tags: ['chatbot', 'lead', body.lang],
        });
        ticketId = ticket.id;
      } catch (error) {
        deps.logger.error({ err: error }, 'lead ticket creation failed');
        return reply.code(502).send({ error: 'unavailable' });
      }

      await deps.conversations.recordLead({
        conversationId: body.conversationId ?? null,
        freshdeskTicketId: ticketId,
        lang: body.lang,
      });
      deps.logger.info({ freshdeskTicketId: ticketId, lang: body.lang }, 'lead submitted');
      return reply.code(201).send({ ok: true });
    },
  );
}
