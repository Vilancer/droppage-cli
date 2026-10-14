import Conf from 'conf';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SupportedStorage } from '@supabase/supabase-js';

const FORBIDDEN = /service_role|sb_secret/i;

type DroppageConfStore = Record<string, string>;
type UpdateCheckStore = {
  lastCheckedAt?: string;
  latest?: string;
};

type ConfSlot<T extends Record<string, unknown>> = {
  instance?: Conf<T>;
  home?: string;
};

const sessionConf: ConfSlot<DroppageConfStore> = {};
const updateCheckConf: ConfSlot<UpdateCheckStore> = {};

function confAt<T extends Record<string, unknown>>(
  slot: ConfSlot<T>,
  configName: string,
): Conf<T> {
  const home = homedir();
  if (!slot.instance || slot.home !== home) {
    slot.home = home;
    slot.instance = new Conf<T>({
      cwd: join(home, '.droppage'),
      configName,
      configFileMode: 0o600,
    });
  }
  return slot.instance;
}

/** Path to session-only config: ~/.droppage/config.json (D-08, CLI-02). */
export function getDroppageConfigPath(): string {
  return join(homedir(), '.droppage', 'config.json');
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

/** Conf singleton scoped to current homedir (session tokens only — never URL/anon). */
export function getConf(): Conf<DroppageConfStore> {
  return confAt(sessionConf, 'config');
}

/** Non-identifying npm release cache: ~/.droppage/update-check.json. */
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
