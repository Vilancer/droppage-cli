import Conf from 'conf';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SupportedStorage } from '@supabase/supabase-js';

const FORBIDDEN = /service_role|sb_secret/i;

type DroppageConfStore = Record<string, string>;
type UpdateCheckStore = {
  lastCheckedAt?: string;
  latest?: string;
};

type ConfSlot<T extends Record<string, unknown>> = {
  instance?: Conf<T>;
  dir?: string;
};

const sessionConf: ConfSlot<DroppageConfStore> = {};
const updateCheckConf: ConfSlot<UpdateCheckStore> = {};

/**
 * The folder holding the session and the update-check cache: `$DROPPAGE_HOME`
 * when set (relative paths resolve against the current folder), else
 * `~/.droppage`. Lets scripts, CI and tests keep their own session without
 * touching HOME. A `./.env` file cannot set it (see `resolveSupabaseEnv`).
 */
export function getDroppageDir(): string {
  const dir = process.env.DROPPAGE_HOME?.trim();
  return dir ? resolve(dir) : join(homedir(), '.droppage');
}

function confAt<T extends Record<string, unknown>>(
  slot: ConfSlot<T>,
  configName: string,
): Conf<T> {
  const dir = getDroppageDir();
  if (!slot.instance || slot.dir !== dir) {
    slot.dir = dir;
    slot.instance = new Conf<T>({
      cwd: dir,
      configName,
      configFileMode: 0o600,
    });
  }
  return slot.instance;
}

/** Path to session-only config: <droppage dir>/config.json (D-08, CLI-02). */
export function getDroppageConfigPath(): string {
  return join(getDroppageDir(), 'config.json');
}

/**
 * Reject config objects that include privileged secret keys or values (ARCH-02).
 */
export function validateConfig(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN.test(key)) {
      throw new Error(
        `Config key rejected: must not contain service_role or sb_secret (${key})`,
      );
    }
    if (typeof value === 'string' && FORBIDDEN.test(value)) {
      throw new Error(
        'Config value rejected: must not contain service_role or sb_secret',
      );
    }
  }
}

/** Conf singleton scoped to the droppage folder (session tokens only — never URL/anon). */
export function getConf(): Conf<DroppageConfStore> {
  return confAt(sessionConf, 'config');
}

/** Non-identifying npm release cache: <droppage dir>/update-check.json. */
export function getUpdateCheckConf(): Conf<UpdateCheckStore> {
  return confAt(updateCheckConf, 'update-check');
}

/**
 * @supabase/supabase-js SupportedStorage adapter backed by Conf.
 * Persists auth session keys only — do not write project URL or anon key here (D-08).
 */
export function createConfStorage(): SupportedStorage {
  const conf = getConf();
  return {
    getItem: (key: string): string | null => {
      const value = conf.get(key as keyof DroppageConfStore);
      return typeof value === 'string' ? value : null;
    },
    setItem: (key: string, value: string): void => {
      validateConfig({ [key]: value });
      conf.set(key as keyof DroppageConfStore, value);
    },
    removeItem: (key: string): void => {
      conf.delete(key as keyof DroppageConfStore);
    },
  };
}
