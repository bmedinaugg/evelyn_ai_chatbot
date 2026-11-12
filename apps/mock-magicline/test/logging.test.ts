import { Writable } from 'node:stream';
import { createLogger } from '@trainmore/shared';
import { expect, it } from 'vitest';
import { profiles } from '../fixtures/profiles.ts';
import { buildMockServer } from '../src/server.ts';

it('request logs show method, path and status but no personal data', async () => {
  let out = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      out += chunk.toString();
      callback();
    },
  });
  const logger = createLogger({ name: 'mock', level: 'info', destination });
  const server = buildMockServer({
    keys: { crossStudio: 'cross-key', studios: {} },
    profiles,
    logger,
  });
  await server.inject({
    method: 'POST',
    url: '/v1/cross-studio/customers/search?debug=jan%40example.com',
    headers: { 'x-api-key': 'cross-key' },
    payload: { email: 'multi@example.com' },
  });
  await server.close();

  const lines = out
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(lines).toContainEqual(
    expect.objectContaining({ req: { method: 'POST', url: '/v1/cross-studio/customers/search' } }),
  );
  expect(lines).toContainEqual(expect.objectContaining({ res: { statusCode: 200 } }));
  expect(out).not.toContain('example.com');
  expect(out).not.toContain('cross-key');
});
