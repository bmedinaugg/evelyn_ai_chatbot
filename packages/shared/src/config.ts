import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    APP_ENV: z.enum(['local', 'preprod', 'prod']),
    AWS_REGION: z.string().min(1),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env, { reportInput: false });
  if (!result.success) {
    // Only key names and our own messages: received values may be secrets.
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      const reason = issue.code === 'custom' ? issue.message : describeIssue(issue);
      return `${key}: ${reason}`;
    });
    throw new ConfigError(issues);
  }
  const e = result.data;
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
