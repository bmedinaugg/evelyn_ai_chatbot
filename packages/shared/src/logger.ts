import { format } from 'node:util';
import {
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type Logger,
  pino,
} from 'pino';
import type { Config } from './config.ts';
import { redactDeep, redactLogObject, scrubText } from './redact.ts';

export type { Logger };

export type LoggerOptions = {
  name: string;
  level: Config['logLevel'];
  destination?: DestinationStream;
};

/**
 * Structured JSON logger that strips personal data from fields, bindings, errors and messages.
 * Messages are interpolated here (after redacting the arguments), so pino never formats raw values.
 */
export function createLogger(opts: LoggerOptions): Logger {
  const logger = pino(
    {
      name: opts.name,
      level: opts.level,
      // Errors are serialised (and redacted) in formatters.log; pino's default `err` serializer
      // runs afterwards and would turn the plain object back into `{ type: 'Object' }`.
      serializers: { err: (value: unknown) => value },
      formatters: {
        log: (object) => redactLogObject(object),
        bindings: (bindings) => {
          const { name, ...rest } = bindings;
          return { ...(name === undefined ? {} : { name }), ...(redactDeep(rest) as object) };
        },
      },
      hooks: {
        logMethod(args, method) {
          method.apply(this, toSafeArgs(args) as Parameters<typeof method>);
        },
      },
    },
    opts.destination,
  );
  return withRedactedChildBindings(logger);
}

/** pino skips `formatters.bindings` for child loggers, so child bindings are redacted here. */
function withRedactedChildBindings(logger: Logger): Logger {
  const original = logger.child.bind(logger);
  const redactingChild = (bindings: Bindings, options?: ChildLoggerOptions): Logger =>
    withRedactedChildBindings(original(redactDeep(bindings) as Bindings, options));
  // Cast via unknown: pino's `child` is generic over custom levels, which this wrapper passes through unchanged.
  logger.child = redactingChild as unknown as Logger['child'];
  return logger;
}

function toSafeArgs(args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (first instanceof Error) {
    const [message, ...params] = rest;
    const text = typeof message === 'string' ? message : first.message;
    return [{ err: first }, safeFormat(text, typeof message === 'string' ? params : [])];
  }
  if (typeof first === 'string') {
    return [safeFormat(first, rest)];
  }
  if (rest.length === 0) return [first];
  const [message, ...params] = rest;
  return typeof message === 'string' ? [first, safeFormat(message, params)] : args;
}

function safeFormat(message: string, params: unknown[]): string {
  const text = params.length === 0 ? message : format(message, ...params.map((p) => redactDeep(p)));
  return scrubText(text);
}
