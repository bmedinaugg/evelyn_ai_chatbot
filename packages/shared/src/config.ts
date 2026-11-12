import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Env keys every service needs; reused by loadRuntimeConfig. */
export const runtimeEnvShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_ENV: z.enum(['local', 'preprod', 'prod']),
  AWS_REGION: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
};

const envSchema = z
  .object({
    ...runtimeEnvShape,
    MAGICLINE_BASE_URL: z.url(),
    MAGICLINE_USE_MOCK: booleanString,
  })
  .superRefine((env, ctx) => {
    // Never use real Magicline data outside prod, and never the mock in prod.
    if (env.APP_ENV !== 'prod' && !env.MAGICLINE_USE_MOCK) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAGICLINE_USE_MOCK'],
        message: `MAGICLINE_USE_MOCK must be true when APP_ENV is ${env.APP_ENV}`,
      });
    }
    if (env.APP_ENV === 'prod' && env.MAGICLINE_USE_MOCK) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAGICLINE_USE_MOCK'],
        message: 'MAGICLINE_USE_MOCK must be false when APP_ENV is prod',
      });
    }
  });

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  appEnv: 'local' | 'preprod' | 'prod';
  awsRegion: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  magicline: { baseUrl: string; useMock: boolean };
};

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export type Env = Record<string, string | undefined>;

/**
 * Parses env with a schema, throwing ConfigError that names keys but never received values.
 * Custom issue messages must not include values either.
 */
export function parseEnv<T extends z.ZodType>(schema: T, env: Env): z.output<T> {
  const result = schema.safeParse(env, { reportInput: false });
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      const reason = issue.code === 'custom' ? issue.message : describeIssue(issue);
      return `${key}: ${reason}`;
    });
    throw new ConfigError(issues);
  }
  return result.data;
}

export function loadConfig(env: Env = process.env): Config {
  const e = parseEnv(envSchema, env);
  return {
    nodeEnv: e.NODE_ENV,
    appEnv: e.APP_ENV,
    awsRegion: e.AWS_REGION,
    logLevel: e.LOG_LEVEL,
    magicline: { baseUrl: e.MAGICLINE_BASE_URL, useMock: e.MAGICLINE_USE_MOCK },
  };
}

function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return 'is missing or has the wrong type';
    case 'invalid_value':
      return `must be one of ${issue.values.map(String).join(', ')}`;
    case 'invalid_format':
      return `must be a valid ${issue.format}`;
    default:
      return 'is invalid';
  }
}
