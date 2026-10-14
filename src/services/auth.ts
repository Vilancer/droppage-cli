import { input } from '@inquirer/prompts';
import type { User } from '@supabase/supabase-js';
import open from 'open';
import { z } from 'zod';
import { pickCallbackPort, waitForAuthCode } from '../lib/callback-server.js';
import { resolveSupabaseEnv } from '../lib/env.js';
import { createSupabaseClient } from '../lib/supabase.js';

// Exported so the upload command validates --email values with the SAME schema
// used for login (D-07 validate-before-network). Single source of email truth.
export const emailSchema = z.email();

const INBUCKET_URL = 'http://127.0.0.1:54324';
const AUTH_REQUIRED_MESSAGE =
  'Not logged in. Run `droppage login` and try again.';

export class AuthRequiredError extends Error {
  constructor(message = AUTH_REQUIRED_MESSAGE) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

function isLocalSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const localHost =
      parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (!localHost) return false;
    // Typical supabase start API port; empty port also treated as local stack
    return parsed.port === '54321' || parsed.port === '';
  } catch {
    return false;
  }
}

/**
 * Validated current user via Auth API (not getSession alone — Pitfall 4).
 * Clears local session on error and returns null.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    if (error) {
      await supabase.auth.signOut({ scope: 'local' });
    }
    return null;
  }
  return data.user;
}

/**
 * Magic-link login with localhost PKCE (D-01..D-04, D-13..D-15).
 * Already authenticated → print status and return (no new OTP).
 */
export async function login(): Promise<void> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (!error && data.user?.email) {
    console.log(`Logged in as ${data.user.email}`);
    process.exitCode = 0;
    return;
  }

  if (error) {
    await supabase.auth.signOut({ scope: 'local' });
  }

  const emailRaw = await input({
    message: 'Email:',
    validate: (value) => {
      const result = emailSchema.safeParse(value.trim());
      return result.success ? true : 'Enter a valid email address';
    },
  });
  const email = emailRaw.trim();

  const port = await pickCallbackPort();
  const emailRedirectTo = `http://127.0.0.1:${port}/callback`;

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo,
    },
  });

  if (otpError) {
    console.error(`Failed to send magic link: ${otpError.message}`);
    process.exitCode = 1;
    throw otpError;
  }

  // CR-01: arm the loopback callback waiter only AFTER a successful OTP send.
  // waitForAuthCode binds an HTTP server and a 300s timeout; arming it before
  // signInWithOtp meant an OTP failure threw without closing them, keeping the
  // event loop alive for up to 5 minutes and orphaning the promise as an
  // unhandled rejection. The user must still receive and click the emailed link
  // (seconds or more) — far longer than this localhost bind — so the redirect
  // target is ready in time.
  const codePromise = waitForAuthCode({ port, path: '/callback' });

  console.log('Check your email for a magic link to sign in.');
  console.log(
    `(debug) After you click the link, Auth redirects to: ${emailRedirectTo}`,
  );

  // D-04: never open emailRedirectTo (loopback callback ≠ magic link).
  // Optionally open Inbucket when using local Supabase, unless scripted runs
  // ask for no browser (DROPPAGE_NO_BROWSER=1) or this is CI.
  const { url } = resolveSupabaseEnv();
  const noBrowser = Boolean(process.env.DROPPAGE_NO_BROWSER || process.env.CI);
  if (isLocalSupabaseUrl(url) && !noBrowser) {
    try {
      await open(INBUCKET_URL);
    } catch {
      // headless/SSH — non-fatal
    }
  }

  try {
    const code = await codePromise;
    const { data: sessionData, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError || !sessionData.user?.email) {
      const message =
        exchangeError?.message ?? 'No user after code exchange';
      console.error(`Login failed: ${message}`);
      process.exitCode = 1;
      throw exchangeError ?? new Error(message);
    }

    console.log(`Logged in as ${sessionData.user.email}`);
    process.exitCode = 0;
  } catch (err) {
    if (process.exitCode !== 1) {
      console.error(
        `Login failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
    throw err;
  }
}

/**
 * Clear publisher session. Idempotent success when already logged out (D-11).
 */
export async function logout(): Promise<void> {
  const supabase = createSupabaseClient();
  const { data } = await supabase.auth.getSession();

  if (!data.session) {
    console.log('Already logged out');
    process.exitCode = 0;
    return;
  }

  await supabase.auth.signOut();
  console.log('Logged out');
  process.exitCode = 0;
}

/**
 * Hard auth gate for protected commands (D-09, D-10).
 * Never auto-starts login. Clears invalid/expired local sessions.
 */
export async function requireAuth(): Promise<User> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    await supabase.auth.signOut({ scope: 'local' });
    console.error(AUTH_REQUIRED_MESSAGE);
    process.exitCode = 1;
    throw new AuthRequiredError();
  }

  return data.user;
}
