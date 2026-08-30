import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createConfStorage } from './config.js';
import { resolveSupabaseEnv } from './env.js';

export type { SupabaseClient };

/** Module-level singleton — one Conf storage + client for the process (Pitfall 1 / T-02-09). */
let client: SupabaseClient | undefined;

/**
 * Shared Supabase JS client with PKCE and Conf-backed session storage.
 * Uses resolved anon key + URL only — never a privileged secret (ARCH-02 / T-02-08).
 */
export function createSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const { url, anonKey } = resolveSupabaseEnv();
  client = createClient(url, anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: createConfStorage(),
    },
  });
  return client;
}
