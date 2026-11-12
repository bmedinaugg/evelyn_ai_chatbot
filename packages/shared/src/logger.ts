import { type DestinationStream, type Logger, pino } from 'pino';
import type { Config } from './config.ts';
import { redactDeep, scrubText } from './redact.ts';

export type LoggerOptions = {
  name: string;
  level: Config['logLevel'];
  destination?: DestinationStream;
};

/** Structured JSON logger that strips personal data from every field and message. */
export function createLogger(opts: LoggerOptions): Logger {
  return pino(
    {
      name: opts.name,
      level: opts.level,
      serializers: { err: pino.stdSerializers.err },
      formatters: {
        log: (object) => redactDeep(object) as Record<string, unknown>,
      },
      hooks: {
        logMethod(args, method) {
          const scrubbed = args.map((arg) => (typeof arg === 'string' ? scrubText(arg) : arg));
          method.apply(this, scrubbed as Parameters<typeof method>);
        },
      },
    },
    opts.destination,
  );
}
