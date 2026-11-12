import { describe, expect, it } from 'vitest';
import { createTurnstileVerifier, SITEVERIFY_URL } from '../src/turnstile.ts';

const TEST_SECRET = '1x0000000000000000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function fakeFetch(handler: (req: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    requests.push(req.clone());
    return handler(req);
  };
  return { fetchImpl, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createTurnstileVerifier', () => {
  it('posts the form fields to siteverify and accepts success', async () => {
    const { fetchImpl, requests } = fakeFetch(() => json({ success: true, 'error-codes': [] }));
    const verify = createTurnstileVerifier({ secretKey: TEST_SECRET, fetch: fetchImpl });
    expect(await verify(TOKEN, '203.0.113.7')).toBe(true);
    expect(requests[0]?.url).toBe(SITEVERIFY_URL);
    expect(requests[0]?.method).toBe('POST');
    const form = new URLSearchParams(await requests[0]?.text());
    expect(Object.fromEntries(form)).toEqual({
      secret: TEST_SECRET,
      response: TOKEN,
      remoteip: '203.0.113.7',
    });
  });

  it('rejects a duplicate or failed token', async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );
    expect(
      await createTurnstileVerifier({ secretKey: TEST_SECRET, fetch: fetchImpl })(TOKEN, '::1'),
    ).toBe(false);
  });

  it('is false on a server error, a network error or an unexpected body', async () => {
    for (const handler of [
      () => json({}, 500),
      () => {
        throw new Error('network down');
      },
      () => json({ ok: 'maybe' }),
    ]) {
      const { fetchImpl } = fakeFetch(handler);
      expect(
        await createTurnstileVerifier({ secretKey: TEST_SECRET, fetch: fetchImpl })(TOKEN, '::1'),
      ).toBe(false);
    }
  });

  it('rejects an over-long or empty token without calling Cloudflare', async () => {
    const { fetchImpl, requests } = fakeFetch(() => json({ success: true }));
    const verify = createTurnstileVerifier({ secretKey: TEST_SECRET, fetch: fetchImpl });
    expect(await verify('x'.repeat(2049), '::1')).toBe(false);
    expect(await verify('', '::1')).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('gives up after the timeout', async () => {
    const { fetchImpl } = fakeFetch(
      (req) =>
        new Promise<Response>((_resolve, reject) => {
          req.signal.addEventListener('abort', () => reject(req.signal.reason));
        }),
    );
    const verify = createTurnstileVerifier({
      secretKey: TEST_SECRET,
      fetch: fetchImpl,
      timeoutMs: 20,
    });
    expect(await verify(TOKEN, '::1')).toBe(false);
  });
});
