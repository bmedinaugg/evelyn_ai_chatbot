import type { components } from '@trainmore/magicline';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';
import { studios } from '../fixtures/studios.ts';

type Customer = components['schemas']['Customer'];

export type MockKeys = { crossStudio: string; studios: Record<number, string> };

export type MockServerOptions = {
  keys: MockKeys;
  profiles: Customer[];
  studios?: components['schemas']['StudioInformation'][];
  logger?: FastifyBaseLogger;
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
    const email = body.data.email.toLowerCase();
    return opts.profiles.filter((customer) => customer.email?.toLowerCase() === email);
  });

  app.get('/v1/studios/information', async (request, reply) => {
    const key = apiKey(request);
    const studioId = typeof key === 'string' ? studioForKey.get(key) : undefined;
    if (studioId === undefined) return reply.code(401).send();
    const studio = (opts.studios ?? studios).find((s) => s.studioId === studioId);
    return studio ?? reply.code(404).send();
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
