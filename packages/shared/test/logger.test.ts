import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.ts';
import { scrubText } from '../src/redact.ts';

let out: string;
let log: ReturnType<typeof createLogger>;

beforeEach(() => {
  out = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      out += chunk.toString();
      callback();
    },
  });
  log = createLogger({ name: 'test', level: 'info', destination });
});

describe('createLogger', () => {
  it('redacts PII keys at any depth, in arrays, case-insensitively', () => {
    log.info(
      {
        customer: {
          Email: 'jan@example.com',
          contracts: [{ phonePrivateMobile: '+31 6 12345678' }],
        },
      },
      'lookup',
    );
    expect(out).not.toContain('jan@example.com');
    expect(out).not.toContain('12345678');
    expect(out).toContain('[redacted]');
  });

  it('scrubs emails and phone numbers inside error messages', () => {
    log.error({ err: new Error('no customer for jan@example.com / 0612345678') }, 'failed');
    expect(out).not.toContain('jan@example.com');
    expect(out).not.toContain('0612345678');
  });

  it('scrubs emails in the log message itself', () => {
    log.info('sending code to jan@example.com');
    expect(out).not.toContain('jan@example.com');
  });

  it('keeps non-PII fields', () => {
    log.info({ studioId: 1001, status: 'MEMBER' }, 'ok');
    expect(JSON.parse(out)).toMatchObject({
      studioId: 1001,
      status: 'MEMBER',
      msg: 'ok',
      name: 'test',
    });
  });
});

describe('scrubText', () => {
  it('leaves short numbers alone', () => {
    expect(scrubText('studio 1001 has 25 classes')).toBe('studio 1001 has 25 classes');
  });

  it('replaces international phone formats', () => {
    expect(scrubText('call +31 6-1234 5678 now')).toBe('call [redacted] now');
  });
});
