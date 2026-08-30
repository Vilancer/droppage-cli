/**
 * Wave 0 contract for localhost PKCE callback waiter (Plan 04 implements).
 * Expected exports from ./callback-server.js:
 * - waitForAuthCode(port, path?): Promise<string>
 * - optionally startCallbackServer
 */
import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { waitForAuthCode } from './callback-server.js';

async function listenEphemeral(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('expected TCP address');
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return {
    port,
    close: async () => undefined,
  };
}

test('waitForAuthCode resolves with code from GET /callback?code=', async () => {
  const { port } = await listenEphemeral();
  const pending = waitForAuthCode(port);

  // Give the server a tick to bind before hitting it
  await new Promise((r) => setTimeout(r, 50));

  const res = await fetch(`http://127.0.0.1:${port}/callback?code=pkce-test-code`);
  expect(res.ok).toBe(true);

  await expect(pending).resolves.toBe('pkce-test-code');
});

test('waitForAuthCode rejects when error query present', async () => {
  const { port } = await listenEphemeral();
  const pending = waitForAuthCode(port);

  await new Promise((r) => setTimeout(r, 50));

  await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&error_description=denied`);

  await expect(pending).rejects.toThrow(/denied|error|access_denied/i);
});
