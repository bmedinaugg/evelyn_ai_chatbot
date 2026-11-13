import type { components } from '@trainmore/magicline';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';
import { accountData } from '../fixtures/account-data.ts';
import { studios } from '../fixtures/studios.ts';

type Customer = components['schemas']['Customer'];

export type MockKeys = { crossStudio: string; studios: Record<number, string> };

export type MockServerOptions = {
  keys: MockKeys;
  profiles: Customer[];
  studios?: components['schemas']['StudioInformation'][];
  logger?: FastifyBaseLogger;
  /** Lower-cased alias -> profile email: lets testers log in with a mailbox they can read. */
  emailAliases?: Record<string, string>;
};

const searchBodySchema = z.object({ email: z.string().trim().min(1) });
const customerParamsSchema = z.object({ customerId: z.coerce.number().int() });

/** Parses `cross:<key>,<studioId>:<key>,...` (mock-only keys, not secrets). */
export function parseMockKeys(raw: string): MockKeys {
  let crossStudio: string | undefined;
  const studios: Record<number, string> = {};
  for (const entry of raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [scope, key] = entry.split(':');
    if (!scope || !key) throw new Error(`Malformed mock key entry "${scope ?? ''}:…"`);
    if (scope === 'cross') {
      crossStudio = key;
    } else if (/^\d+$/.test(scope)) {
      studios[Number(scope)] = key;
    } else {
      throw new Error(`Unknown mock key scope "${scope}"`);
    }
  }
  if (!crossStudio) throw new Error('Mock keys need a cross:<key> entry');
  return { crossStudio, studios };
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Parses `alias@domain=profile@example.com,...` (preprod: plus-addresses of a test mailbox mapped
 * to synthetic profiles, so the profiles themselves stay on example.com).
 */
export function parseEmailAliases(raw: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const entry of raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [alias, target, extra] = entry.split('=');
    const a = emailSchema.safeParse(alias);
    const t = emailSchema.safeParse(target);
    if (extra !== undefined || !a.success || !t.success) {
      throw new Error('Malformed email alias entry (expected alias@domain=profile@domain)');
    }
    aliases[a.data] = t.data;
  }
  return aliases;
}

export function buildMockServer(opts: MockServerOptions): FastifyInstance {
  const app = Fastify(opts.logger ? { loggerInstance: opts.logger } : { logger: false });

  const studioForKey = new Map<string, number>(
    Object.entries(opts.keys.studios).map(([studioId, key]) => [key, Number(studioId)]),
  );
  const apiKey = (request: FastifyRequest) => request.headers['x-api-key'];

  // Like the real API, each studio key only sees its own studio.
  app.post('/v1/cross-studio/customers/search', async (request, reply) => {
    if (apiKey(request) !== opts.keys.crossStudio) return reply.code(401).send();
    const body = searchBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: 'email is required' });
    // Assumption: case-insensitive exact match (real Magicline behaviour unverified).
    const given = body.data.email.toLowerCase();
    const email = opts.emailAliases?.[given] ?? given;
    return opts.profiles.filter((customer) => customer.email?.toLowerCase() === email);
  });

  app.get('/v1/studios/information', async (request, reply) => {
    const key = apiKey(request);
    const studioId = typeof key === 'string' ? studioForKey.get(key) : undefined;
    if (studioId === undefined) return reply.code(401).send();
    const studio = (opts.studios ?? studios).find((s) => s.studioId === studioId);
    return studio ?? reply.code(404).send();
  });

  // Account data: the studio key only sees its own customers (404 otherwise), like the real API.
  const studioCustomer = (request: FastifyRequest, reply: FastifyReply) => {
    const key = apiKey(request);
    const studioId = typeof key === 'string' ? studioForKey.get(key) : undefined;
    if (studioId === undefined) {
      void reply.code(401).send();
      return undefined;
    }
    const params = customerParamsSchema.safeParse(request.params);
    const customer = params.success
      ? opts.profiles.find((c) => c.id === params.data.customerId && c.studioId === studioId)
      : undefined;
    if (!customer) {
      void reply.code(404).send();
      return undefined;
    }
    return accountData[customer.id];
  };
  const sliced = (result: unknown[]) => ({ result, hasNext: false, offset: '0' });
  // Enforce the documented parameter ranges, like the real API (docs/api/magicline-openapi.json).
  const inRange = (request: FastifyRequest, name: string, min: number, max: number) => {
    const raw = (request.query as Record<string, string | undefined>)[name];
    if (raw === undefined) return true;
    const value = Number(raw);
    return Number.isInteger(value) && value >= min && value <= max;
  };

  app.get(
    '/v1/customers/:customerId/contracts',
    async (request, reply) => studioCustomer(request, reply)?.contracts ?? reply,
  );
  app.get(
    '/v1/customers/:customerId/account/balances',
    async (request, reply) => studioCustomer(request, reply)?.balance ?? reply,
  );
  app.get('/v1/customers/:customerId/account/transactions/upcoming', async (request, reply) => {
    const data = studioCustomer(request, reply);
    return data ? sliced(data.upcoming) : reply;
  });
  app.get('/v1/customers/:customerId/activities/checkins', async (request, reply) => {
    if (!inRange(request, 'sliceSize', 1, 50)) return reply.code(400).send();
    const data = studioCustomer(request, reply);
    return data ? sliced(data.checkins) : reply;
  });
  app.get('/v1/cross-studio/customers/:customerId/class-bookings', async (request, reply) => {
    if (!inRange(request, 'daysAhead', 0, 6) || !inRange(request, 'sliceSize', 1, 50))
      return reply.code(400).send();
    if (apiKey(request) !== opts.keys.crossStudio) return reply.code(401).send();
    const params = customerParamsSchema.safeParse(request.params);
    const data = params.success ? accountData[params.data.customerId] : undefined;
    return data ? sliced(data.classBookings) : reply.code(404).send();
  });

  app.get('/v1/customers/:customerId', async (request, reply) => {
    const key = apiKey(request);
    const studioId = typeof key === 'string' ? studioForKey.get(key) : undefined;
    if (studioId === undefined) return reply.code(401).send();
    const params = customerParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send();
    const customer = opts.profiles.find(
      (c) => c.id === params.data.customerId && c.studioId === studioId,
    );
    return customer ?? reply.code(404).send();
  });

  return app;
}
