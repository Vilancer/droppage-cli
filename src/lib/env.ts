import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_SUPABASE_ANON_KEY,
  DEFAULT_SUPABASE_URL,
} from './supabase-defaults.js';

const SECRET_PATTERN = /service_role|sb_secret/i;

const urlSchema = z.string().url();
const anonKeySchema = z.string().min(1);

function rejectSecrets(label: string, value: string): void {
  if (SECRET_PATTERN.test(value)) {
    throw new Error(
      `${label} must not contain service_role or sb_secret (ARCH-02)`,
    );
  }
}

/**
 * Resolve Supabase URL + anon key.
 * Precedence: DROPPAGE_* → SUPABASE_* → baked defaults (D-05/D-06).
 * Loads process.cwd()/.env only (D-07) — never ~/.droppage/.env.
 */
export function resolveSupabaseEnv(): { url: string; anonKey: string } {
  // `quiet` suppresses dotenv's own stdout banner, which would otherwise
  // corrupt the machine-readable stdout contract (URL / JSON / id only).
  loadDotenv({ path: join(process.cwd(), '.env'), quiet: true });

  const url =
    process.env.DROPPAGE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;

  const anonKey =
    process.env.DROPPAGE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_ANON_KEY;

  if (!url.trim() || !anonKey.trim()) {
    throw new Error(
      'Missing Supabase configuration. Set DROPPAGE_SUPABASE_URL and DROPPAGE_SUPABASE_ANON_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY).',
    );
  }

  rejectSecrets('DROPPAGE_SUPABASE_URL / URL', url);
  rejectSecrets('DROPPAGE_SUPABASE_ANON_KEY / anon key', anonKey);

  return {
    url: urlSchema.parse(url),
    anonKey: anonKeySchema.parse(anonKey),
  };
}
