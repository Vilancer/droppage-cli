/**
 * End-to-end tracer proof against a LIVE local Supabase stack (`supabase start`).
 *
 * Guarded: runs only when SUPABASE_URL + an anon key + SUPABASE_SERVICE_ROLE_KEY are
 * exported AND the REST endpoint answers; otherwise each test cleanly SKIPS (never
 * fails) with a message explaining why. No @supabase/supabase-js mocking here — this
 * exercises the real upload() service and the real serve GET handler.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.DROPPAGE_SUPABASE_URL ??
  'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.DROPPAGE_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BUCKET = process.env.DROPPAGE_BUCKET ?? 'pages';

const hasEnv = Boolean(ANON_KEY && SERVICE_ROLE_KEY);

let reachable = false;
let admin: SupabaseClient | undefined;
let tmpDir = '';
let originalHome: string | undefined;
let userId = '';
let testUser: User | undefined;
const testEmail = `tracer-${randomUUID()}@example.com`;
const testPassword = `Pw-${randomUUID()}!`;

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: ANON_KEY },
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

function skipReason(): string {
  return `[skip] live local Supabase not usable (hasEnv=${hasEnv}, reachable=${reachable}). Export SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and run \`supabase start\`.`;
}

beforeAll(async () => {
  if (!hasEnv) return;
  reachable = await probe();
  if (!reachable) return;

  // Isolate the CLI's Conf session store to a throwaway HOME so we never touch
  // the developer's real ~/.droppage session. Must be set before the first
  // createSupabaseClient() call (Conf binds to homedir() at creation).
  tmpDir = await mkdtemp(join(tmpdir(), 'droppage-it-'));
  originalHome = process.env.HOME;
  process.env.HOME = join(tmpDir, 'home');
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;

  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const created = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  userId = created.data.user?.id ?? '';
  const promoted = await admin.from('admin_users').insert({ user_id: userId });
  if (promoted.error) throw promoted.error;

  // Sign the CLI client in so upload()'s requireAuth() sees a real publisher JWT.
  const { createSupabaseClient } = await import('../lib/supabase.js');
  const cli = createSupabaseClient();
  const signIn = await cli.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (signIn.error) throw signIn.error;
  // WR-04: the command resolves the publisher once and threads it into upload();
  // mirror that here with the signed-in user instead of an internal requireAuth().
  testUser = signIn.data.user ?? undefined;
});

afterAll(async () => {
  if (admin && userId) {
    const { data: rows } = await admin
      .from('pages')
      .select('storage_path')
      .eq('owner_id', userId);
    if (rows?.length) {
      await admin.storage
        .from(BUCKET)
        .remove(rows.map((r) => r.storage_path as string))
        .catch(() => {});
    }
    // IN-06: service_role now has SELECT-only on pages, so we no longer delete
    // rows via the admin client — deleting the auth user cascades the pages rows
    // (owner_id references auth.users on delete cascade).
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  if (originalHome !== undefined) process.env.HOME = originalHome;
});

test('upload → serve returns the identical bytes as text/html (end-to-end)', async (ctx) => {
  if (!hasEnv || !reachable) {
    console.warn(skipReason());
    ctx.skip();
    return;
  }

  const html = `<!doctype html><html><body><h1>Tracer héllo • 世界 ${randomUUID()}</h1></body></html>`;
  const filePath = join(tmpDir, 'page.html');
  await writeFile(filePath, html, 'utf8');

  const { upload } = await import('./upload.js');
  const url = await upload({ file: filePath, user: testUser! });
  expect(url).toMatch(
    /^https:\/\/droppage\.dev\/p\/[A-Za-z0-9_-]{10}$/,
  );
  const slug = url.slice('https://droppage.dev/p/'.length);

  // Invoke the REAL serve GET handler (service-role client from env) on the same stack.
  const { GET } = await import('../../../serve/app/p/[slug]/route.js');
  const res = await GET(new Request(`http://local/p/${slug}`), {
    params: Promise.resolve({ slug }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  const served = Buffer.from(await res.arrayBuffer());
  expect(served.equals(Buffer.from(html, 'utf8'))).toBe(true);

  // Unknown slug → 404 through the same handler.
  const missing = await GET(new Request('http://local/p/zzzzzzzzzz'), {
    params: Promise.resolve({ slug: 'zzzzzzzzzz' }),
  });
  expect(missing.status).toBe(404);
});

test('CR-01: RLS rejects a pages row whose storage_path is outside the caller folder', async (ctx) => {
  if (!hasEnv || !reachable) {
    console.warn(skipReason());
    ctx.skip();
    return;
  }

  // Malicious insert via the authenticated (anon+JWT, RLS-scoped) CLI client:
  // a legitimately-owned row (owner_id = self) whose storage_path points into
  // ANOTHER owner's folder. The tightened INSERT with-check must block it so the
  // service-role serve tier can never be pointed at a foreign object (CR-01).
  const { createSupabaseClient } = await import('../lib/supabase.js');
  const cli = createSupabaseClient();
  const res = await cli.from('pages').insert({
    slug: `evil-${randomUUID().slice(0, 8)}`,
    owner_id: userId,
    storage_path: `${randomUUID()}/victim.html`, // foreign folder, not `${userId}/...`
    access_mode: 'public',
    view_count: 0,
  });

  expect(res.error).toBeTruthy();
  // RLS with-check violation → insufficient_privilege (42501).
  expect(res.error?.code).toBe('42501');

  // Direct INSERT is now revoked entirely; the quota-aware RPC is the only
  // legitimate metadata creation path and still accepts an owner-scoped row.
  const okSlug = `ok-${randomUUID().slice(0, 8)}`;
  const okPath = `${userId}/${okSlug}.html`;
  const ok = await cli.rpc('create_page_with_entitlements', {
    p_slug: okSlug,
    p_storage_path: okPath,
    p_access_mode: 'public',
  });
  expect(ok.error).toBeNull();
});

test('password gate end-to-end: upload --password → gate → POST → tokenized serve (tracer)', async (ctx) => {
  if (!hasEnv || !reachable) {
    console.warn(skipReason());
    ctx.skip();
    return;
  }

  // Fixture signing secret for the local run (the prod value lives in Vercel —
  // plan 05). Set BEFORE invoking the route: GET/POST read it per-request.
  process.env.UNLOCK_TOKEN_SECRET = 'local-integration-fixture-secret-32bytes!';

  const { hashPassword } = await import('../lib/password.js');
  const { upload } = await import('./upload.js');
  const { GET, POST } = await import('../../../serve/app/p/[slug]/route.js');
  const { mintUnlockToken } = await import(
    '../../../serve/app/p/[slug]/unlock-token.js'
  );

  const html = `<!doctype html><html><body><h1>Secret ${randomUUID()}</h1></body></html>`;
  const filePath = join(tmpDir, 'secret.html');
  await writeFile(filePath, html, 'utf8');

  // Real password upload under RLS + the plan-01 CHECK → access_mode='password'.
  const url = await upload({
    file: filePath,
    user: testUser!,
    passwordHash: await hashPassword('s3cret'),
  });
  const slug = url.slice('https://droppage.dev/p/'.length);

  // The row is genuinely a password row (not public).
  const { data: row } = await admin!
    .from('pages')
    .select('access_mode, password_hash')
    .eq('slug', slug)
    .single();
  expect(row?.access_mode).toBe('password');
  expect(typeof row?.password_hash).toBe('string');

  // GET without a token → gate response, NOT the uploaded HTML, no bytes served.
  const gated = await GET(new Request(`http://local/p/${slug}`), {
    params: Promise.resolve({ slug }),
  });
  const gatedBody = await gated.text();
  expect(gatedBody).not.toContain('Secret ');
  expect(gatedBody).toContain('type="password"');

  // POST the correct password → 303 redirect to /p/:slug?k=<token>.
  const form = new FormData();
  form.set('password', 's3cret');
  const redirect = await POST(
    new Request(`http://local/p/${slug}`, { method: 'POST', body: form }),
    { params: Promise.resolve({ slug }) },
  );
  expect(redirect.status).toBe(303);
  const location = redirect.headers.get('Location') ?? '';
  expect(location).toMatch(
    new RegExp(`^/p/${slug}\\?k=[A-Za-z0-9_.-]+$`),
  );
  const token = location.slice(location.indexOf('?k=') + 3);

  // GET with the minted token → 200 + text/html + identical bytes.
  const unlocked = await GET(new Request(`http://local/p/${slug}?k=${token}`), {
    params: Promise.resolve({ slug }),
  });
  expect(unlocked.status).toBe(200);
  expect(unlocked.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  const served = Buffer.from(await unlocked.arrayBuffer());
  expect(served.equals(Buffer.from(html, 'utf8'))).toBe(true);

  // A token minted for a DIFFERENT slug must NOT unlock this page (replay guard).
  const wrongToken = mintUnlockToken(
    'zzzzzzzzzz',
    process.env.UNLOCK_TOKEN_SECRET,
  );
  const cross = await GET(
    new Request(`http://local/p/${slug}?k=${wrongToken}`),
    { params: Promise.resolve({ slug }) },
  );
  const crossBody = await cross.text();
  expect(crossBody).not.toContain('Secret ');
  expect(crossBody).toContain('type="password"');
});

test('four-mode CHECK: email/private/public commit consistent rows; an empty email allowlist is rejected (ACC-02/ACC-03 / D-08a)', async (ctx) => {
  if (!hasEnv || !reachable) {
    console.warn(skipReason());
    ctx.skip();
    return;
  }

  const { upload } = await import('./upload.js');
  const html = `<!doctype html><html><body><h1>modes ${randomUUID()}</h1></body></html>`;
  const filePath = join(tmpDir, 'modes.html');
  await writeFile(filePath, html, 'utf8');

  // 1. email mode → non-empty allowlist, access_mode='email', password_hash NULL.
  const emailUrl = await upload({
    file: filePath,
    user: testUser!,
    allowedEmails: ['recipient-a@example.com', 'recipient-b@example.com'],
    accessMode: 'email',
  });
  const emailSlug = emailUrl.slice('https://droppage.dev/p/'.length);
  const { data: emailRow } = await admin!
    .from('pages')
    .select('access_mode, allowed_emails, password_hash')
    .eq('slug', emailSlug)
    .single();
  expect(emailRow?.access_mode).toBe('email');
  expect(emailRow?.allowed_emails).toEqual([
    'recipient-a@example.com',
    'recipient-b@example.com',
  ]);
  expect(emailRow?.password_hash).toBeNull();

  // 2. private mode → single owner-address allowlist, access_mode='private'.
  const ownerEmail = testUser!.email!.toLowerCase();
  const privateUrl = await upload({
    file: filePath,
    user: testUser!,
    allowedEmails: [ownerEmail],
    accessMode: 'private',
  });
  const privateSlug = privateUrl.slice(
    'https://droppage.dev/p/'.length,
  );
  const { data: privateRow } = await admin!
    .from('pages')
    .select('access_mode, allowed_emails, password_hash')
    .eq('slug', privateSlug)
    .single();
  expect(privateRow?.access_mode).toBe('private');
  expect(privateRow?.allowed_emails).toEqual([ownerEmail]);
  expect(privateRow?.password_hash).toBeNull();

  // 3. public mode → NULL/empty allowlist, NULL password_hash.
  const publicUrl = await upload({ file: filePath, user: testUser! });
  const publicSlug = publicUrl.slice(
    'https://droppage.dev/p/'.length,
  );
  const { data: publicRow } = await admin!
    .from('pages')
    .select('access_mode, allowed_emails, password_hash')
    .eq('slug', publicSlug)
    .single();
  expect(publicRow?.access_mode).toBe('public');
  // NULL or empty array — both read as "no allowlist".
  expect(publicRow?.allowed_emails ?? []).toHaveLength(0);
  expect(publicRow?.password_hash).toBeNull();

  // 4. CHECK backstop: an email-mode row with an EMPTY allowlist is rejected by
  // pages_access_mode_consistency (T-05-01) — the DB refuses an open email page
  // even if a buggy/racing write path tried to commit it. Written via the
  // RLS-scoped CLI client with a correctly-scoped storage_path so the CHECK, not
  // RLS, is what fires (check_violation → 23514).
  const { createSupabaseClient } = await import('../lib/supabase.js');
  const cli = createSupabaseClient();
  const badSlug = `bad-${randomUUID().slice(0, 8)}`;
  const bad = await cli.rpc('create_page_with_entitlements', {
    p_slug: badSlug,
    p_storage_path: `${userId}/${badSlug}.html`,
    p_access_mode: 'email',
    p_allowed_emails: [], // empty → forbidden for email mode
  });
  expect(bad.error).toBeTruthy();
  expect(bad.error?.code).toBe('23514'); // check_violation
});

test('two concurrent uploads each get a distinct slug (concurrency edge)', async (ctx) => {
  if (!hasEnv || !reachable) {
    console.warn(skipReason());
    ctx.skip();
    return;
  }

  const html = '<!doctype html><h1>concurrent</h1>';
  const f1 = join(tmpDir, 'c1.html');
  const f2 = join(tmpDir, 'c2.html');
  await Promise.all([writeFile(f1, html, 'utf8'), writeFile(f2, html, 'utf8')]);

  const { upload } = await import('./upload.js');
  const [u1, u2] = await Promise.all([
    upload({ file: f1, user: testUser! }),
    upload({ file: f2, user: testUser! }),
  ]);

  expect(u1).not.toBe(u2);
  const s1 = u1.slice('https://droppage.dev/p/'.length);
  const s2 = u2.slice('https://droppage.dev/p/'.length);
  expect(s1).not.toBe(s2);
  expect(s1).toMatch(/^[A-Za-z0-9_-]{10}$/);
  expect(s2).toMatch(/^[A-Za-z0-9_-]{10}$/);
});

test('billing entitlements default to Free, enforce its monthly meter, and bypass quotas for admins', async (ctx) => {
  if (!hasEnv || !reachable) { console.warn(skipReason()); ctx.skip(); return; }
  const email = `free-${randomUUID()}@example.test`;
  const created = await admin!.auth.admin.createUser({ email, password: testPassword, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('missing free user');
  const freeId = created.data.user.id;
  try {
    const { data: initial, error } = await admin!.rpc('effective_entitlements', { p_user_id: freeId }).single();
    expect(error).toBeNull();
    expect(initial).toMatchObject({ plan_code: 'free', page_limit: 5, monthly_view_limit: 100, can_update: false, can_preview: false });
    const grant = await admin!.rpc('set_entitlement_override', {
      p_admin_user_id: userId,
      p_target_user_id: freeId,
      p_clear: false,
      p_reason: 'integration grant',
      p_values: { granted_plan: 'starter', expires_at: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(grant.error).toBeNull();
    const { data: granted } = await admin!.rpc('effective_entitlements', { p_user_id: freeId }).single();
    expect(granted).toMatchObject({ plan_code: 'starter', can_update: true, can_preview: true });
    const { data: auditRows } = await admin!.from('admin_audit_log').select('id,action').eq('target_user_id', freeId);
    expect(auditRows).toHaveLength(1);
    const immutable = await admin!.from('admin_audit_log').update({ reason: 'tampered' }).eq('id', auditRows![0].id);
    expect(immutable.error?.code).toBe('42501');
    const cleared = await admin!.rpc('set_entitlement_override', {
      p_admin_user_id: userId,
      p_target_user_id: freeId,
      p_clear: true,
      p_reason: 'integration cleanup',
      p_values: {},
    });
    expect(cleared.error).toBeNull();
    await admin!.from('monthly_usage').insert({
      user_id: freeId,
      period_start: new Date().toISOString().slice(0, 7) + '-01',
      served_views: 100,
      served_bytes: 123,
    });
    const { data: allowed } = await admin!.rpc('account_write_allowed', { p_user_id: freeId });
    expect(allowed).toBe(false);

    const providerId = `sub-${randomUUID()}`;
    const subscriptionBase = {
      provider_subscription_id: providerId,
      user_id: freeId,
      plan_code: 'starter',
      cadence: 'monthly',
      variant_id: 'integration-variant',
      provider_updated_at: new Date().toISOString(),
    };
    const insertedSubscription = await admin!.from('billing_subscriptions').insert({
      ...subscriptionBase,
      status: 'past_due',
    });
    expect(insertedSubscription.error).toBeNull();
    const { data: pastDue } = await admin!.rpc('effective_entitlements', { p_user_id: freeId }).single();
    expect(pastDue).toMatchObject({ plan_code: 'starter', can_update: true });

    await admin!.from('billing_subscriptions').update({ status: 'unpaid' }).eq('provider_subscription_id', providerId);
    const { data: unpaid } = await admin!.rpc('effective_entitlements', { p_user_id: freeId }).single();
    expect(unpaid?.plan_code).toBe('starter');

    await admin!.from('billing_subscriptions').update({
      status: 'cancelled',
      ends_at: new Date(Date.now() + 60_000).toISOString(),
    }).eq('provider_subscription_id', providerId);
    const { data: cancelledInGrace } = await admin!.rpc('effective_entitlements', { p_user_id: freeId }).single();
    expect(cancelledInGrace?.plan_code).toBe('starter');

    await admin!.from('billing_subscriptions').update({ ends_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('provider_subscription_id', providerId);
    const { data: cancelledAfterEnd } = await admin!.rpc('effective_entitlements', { p_user_id: freeId }).single();
    expect(cancelledAfterEnd?.plan_code).toBe('free');

    await admin!.from('billing_subscriptions').update({ status: 'expired' }).eq('provider_subscription_id', providerId);
    const { data: expired } = await admin!.rpc('effective_entitlements', { p_user_id: freeId }).single();
    expect(expired?.plan_code).toBe('free');
    const { data: adminEntitlements } = await admin!.rpc('effective_entitlements', { p_user_id: userId }).single();
    expect(adminEntitlements).toMatchObject({ is_admin: true, quota_bypassed: true, can_email_allowlist: true });
  } finally {
    await admin!.auth.admin.deleteUser(freeId);
  }
});
