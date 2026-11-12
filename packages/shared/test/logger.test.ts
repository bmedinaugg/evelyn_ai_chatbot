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

describe('createLogger — review fixes', () => {
  it('keeps the scrubbed error message, type and stack', () => {
    log.error({ err: new Error('no customer for jan@example.com') }, 'failed');
    const line = JSON.parse(out);
    expect(line.err.type).toBe('Error');
    expect(line.err.message).toBe('no customer for [redacted]');
    expect(line.err.stack).toContain('logger.test.ts');
    expect(out).not.toContain('jan@example.com');
  });

  it('keeps error causes, scrubbed', () => {
    const cause = new Error('upstream said jan@example.com');
    log.error({ err: new Error('lookup failed', { cause }) }, 'failed');
    expect(out).toContain('lookup failed');
    expect(out).not.toContain('jan@example.com');
  });

  it('scrubs log.error(err) with the error as the only argument', () => {
    log.error(new Error('lookup for jan@example.com failed'));
    const line = JSON.parse(out);
    expect(out).not.toContain('jan@example.com');
    expect(line.msg).toBe('lookup for [redacted] failed');
    expect(line.err.type).toBe('Error');
  });

  it('redacts printf-style interpolated objects', () => {
    log.info('user %j and %o', { email: 'a@example.nl' }, { firstName: 'Jan' });
    expect(out).not.toContain('a@example.nl');
    expect(out).not.toContain('Jan');
  });

  it('redacts child bindings but keeps the logger name', () => {
    log.child({ email: 'child@example.nl', studioId: 7 }).info('hi');
    const line = JSON.parse(out);
    expect(out).not.toContain('child@example.nl');
    expect(line).toMatchObject({ name: 'test', studioId: 7 });
  });

  it('serialises Date, URL and Buffer instead of dropping them', () => {
    log.info({ at: new Date('2026-11-11T00:00:00Z'), url: new URL('https://x.test/a') }, 'v');
    const line = JSON.parse(out);
    expect(line.at).toBe('2026-11-11T00:00:00.000Z');
    expect(line.url).toBe('https://x.test/a');
  });

  it('logs request method, path without query, and status code', () => {
    const req = {
      method: 'GET',
      url: '/v1/x?email=jan%40example.com',
      headers: { authorization: 'k' },
    };
    log.info({ req, res: { statusCode: 200 } }, 'request completed');
    const line = JSON.parse(out);
    expect(line.req).toEqual({ method: 'GET', url: '/v1/x' });
    expect(line.res).toEqual({ statusCode: 200 });
    expect(out).not.toContain('jan%40example.com');
  });

  it('redacts PII key variants and keeps error name/code', () => {
    log.info(
      {
        e_mail: 'x',
        address: 'Damstraat 1',
        fullName: 'Jan J',
        customerName: 'Jan',
        birthday: '1990-01-01',
        city: 'Utrecht',
      },
      'k',
    );
    for (const leaked of ['Damstraat', 'Jan', '1990-01-01', 'Utrecht'])
      expect(out).not.toContain(leaked);
    out = '';
    const err = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
    log.error({ err, capacity: 30, inputTokens: 1200 }, 'e');
    const line = JSON.parse(out);
    expect(line.err).toMatchObject({ type: 'Error', code: 'ECONNREFUSED' });
    expect(line).toMatchObject({ capacity: 30, inputTokens: 1200 });
  });
});
