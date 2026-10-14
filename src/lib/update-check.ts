import pkg from '../../package.json' with { type: 'json' };
import { getUpdateCheckConf } from './config.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = 'https://registry.npmjs.org/droppage/latest';

type RegistryResponse = { version?: unknown };

function stableVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isNewerVersion(latest: string, current: string): boolean {
  const next = stableVersion(latest);
  const installed = stableVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

function shouldCheck(): boolean {
  return Boolean(process.stderr.isTTY)
    && !process.env.DROPPAGE_NO_UPDATE_CHECK
    && !process.env.CI;
}

/**
 * Runs only after the requested command has completed. The registry request is
 * bounded, sends no identifier, and is advisory: every failure is swallowed.
 */
export async function checkForUpdate(): Promise<void> {
  if (!shouldCheck()) return;

  try {
    const cache = getUpdateCheckConf();
    const lastCheckedAt = Date.parse(cache.get('lastCheckedAt') ?? '');
    const stale = !Number.isFinite(lastCheckedAt) || Date.now() - lastCheckedAt >= CHECK_INTERVAL_MS;
    let latest = cache.get('latest');

    if (stale) {
      const response = await fetch(REGISTRY_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return;
      const body = await response.json() as RegistryResponse;
      if (typeof body.version !== 'string' || !body.version.trim()) return;
      latest = body.version.trim();
      cache.set('latest', latest);
      cache.set('lastCheckedAt', new Date().toISOString());
    }

    if (latest && isNewerVersion(latest, pkg.version)) {
      process.stderr.write(
        `droppage ${pkg.version} → ${latest} available: npm install -g droppage@latest (or droppage upgrade)\n`,
      );
    }
  } catch {
    // Advisory only: config, registry, JSON, and timeout failures stay silent.
  }
}
