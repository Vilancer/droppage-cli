import { createServer, type Server } from 'node:http';

const LOOPBACK = '127.0.0.1';
const PREFERRED_PORT = 19876;
const FALLBACK_PORTS = [19877, 19878, 19879, 19880, 19881, 19882, 19883, 19884, 19885] as const;
const DEFAULT_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 300_000;
const SUCCESS_BODY = 'You can close this window and return to the terminal.';

export type WaitForAuthCodeOptions = {
  port: number;
  path?: string;
  timeoutMs?: number;
};

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function tryListen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, LOOPBACK);
  });
}

/**
 * Prefer port 19876; on EADDRINUSE try 19877–19885 (Pitfall 5).
 * Probe servers are closed before returning.
 */
export async function pickCallbackPort(): Promise<number> {
  const candidates = [PREFERRED_PORT, ...FALLBACK_PORTS];
  for (const port of candidates) {
    try {
      const server = await tryListen(port);
      await closeServer(server);
      return port;
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code !== 'EADDRINUSE') {
        throw err;
      }
    }
  }
  throw new Error(
    `No free localhost callback port in range ${PREFERRED_PORT}–${FALLBACK_PORTS[FALLBACK_PORTS.length - 1]}`,
  );
}

function normalizeArgs(
  portOrOptions: number | WaitForAuthCodeOptions,
  pathArg?: string,
): Required<WaitForAuthCodeOptions> {
  if (typeof portOrOptions === 'number') {
    return {
      port: portOrOptions,
      path: pathArg ?? DEFAULT_PATH,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }
  return {
    port: portOrOptions.port,
    path: portOrOptions.path ?? DEFAULT_PATH,
    timeoutMs: portOrOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Short-lived 127.0.0.1 HTTP waiter for the PKCE `?code=` redirect (D-02).
 * Accepts `waitForAuthCode(port, path?)` or `waitForAuthCode({ port, path?, timeoutMs? })`.
 */
export function waitForAuthCode(
  portOrOptions: number | WaitForAuthCodeOptions,
  pathArg?: string,
): Promise<string> {
  const { port, path, timeoutMs } = normalizeArgs(portOrOptions, pathArg);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn();
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${LOOPBACK}:${port}`);
      if (url.pathname !== path) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_BODY);

      void closeServer(server).then(() => {
        if (code) {
          settle(() => resolve(code));
          return;
        }
        const message =
          errorDescription || error || 'No auth code in callback';
        settle(() => reject(new Error(message)));
      });
    });

    server.on('error', (err) => {
      settle(() => reject(err));
    });

    timeout = setTimeout(() => {
      void closeServer(server).then(() => {
        settle(() =>
          reject(new Error(`Timed out waiting for auth callback on port ${port}`)),
        );
      });
    }, timeoutMs);

    server.listen(port, LOOPBACK);
  });
}
