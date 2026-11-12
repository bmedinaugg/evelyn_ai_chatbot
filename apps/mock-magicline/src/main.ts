import { createLogger } from '@trainmore/shared';
import { z } from 'zod';
import { profiles } from '../fixtures/profiles.ts';
import { buildMockServer, parseMockKeys } from './server.ts';

const env = z
  .object({
    PORT: z.coerce.number().int().positive().default(4010),
    MOCK_MAGICLINE_KEYS: z.string().min(1),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .parse(process.env, { reportInput: false });

const logger = createLogger({ name: 'mock-magicline', level: env.LOG_LEVEL });
const server = buildMockServer({ keys: parseMockKeys(env.MOCK_MAGICLINE_KEYS), profiles, logger });

await server.listen({ port: env.PORT, host: '0.0.0.0' });
