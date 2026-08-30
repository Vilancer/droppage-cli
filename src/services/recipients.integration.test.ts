/**
 * Recipient/outbox invariants proven against a LIVE local Supabase stack.
 *
 * These are the Phase 7 guarantees that only Postgres can actually enforce —
 * atomic limits, RLS scoping, grant boundaries, revocation, and no-double-claim.
 * Unit tests mock the database away, so they cannot prove any of them.
 *
 * Guarded exactly like upload.integration.test.ts: runs only when the local stack
 * is reachable, otherwise each case SKIPS cleanly rather than failing.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.DROPPAGE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.DROPPAGE_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const hasEnv = Boolean(ANON_KEY && SERVICE_ROLE_KEY);
let reachable = false;

let admin: SupabaseClient | undefined;
/** Acts as the page owner (RLS + auth.uid() apply). */
let owner: SupabaseClient | undefined;
/** A second signed-in user, for cross-owner isolation. */
let stranger: SupabaseClient | undefined;

let ownerId = '';
let strangerId = '';
let pageId = '';
let slug = '';

const ownerEmail = `p7-owner-${randomUUID()}@example.com`;
const strangerEmail = `p7-other-${randomUUID()}@example.com`;
const password = `Pw-${randomUUID()}!`;

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } });
    return res.status < 500;
  } catch {
    return false;
  }
}

function skipReason(): string {
  return `[skip] live local Supabase not usable (hasEnv=${hasEnv}, reachable=${reachable}). Export SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and run \`supabase start\`.`;
}

async function signedInClient(email: string): Promise<{ client: SupabaseClient; id: string }> {
  const created = await admin!.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { client, id: created.data.user!.id };
}

/** Reset the page to exactly one active recipient (the seed) between cases. */
async function resetRecipients(): Promise<void> {
  // Drop every non-seed row for THIS page (cascades its jobs), then restore the
  // seed to a clean active/pending state so each case starts from 1 of 3 used.
  await admin!
    .from('page_recipients')
    .delete()
    .eq('page_id', pageId)
    .neq('email', 'seed@example.com');
  await admin!
    .from('page_recipients')
    .update({ status: 'active', invitation_status: 'pending', last_sent_at: null })
    .eq('page_id', pageId)
    .eq('email', 'seed@example.com');
  await admin!.from('invitation_jobs').delete().eq('page_id', pageId);
}

beforeAll(async () => {
  if (!hasEnv) return;
  reachable = await probe();
  if (!reachable) return;

  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const ownerSession = await signedInClient(ownerEmail);
  owner = ownerSession.client;
  ownerId = ownerSession.id;
  const strangerSession = await signedInClient(strangerEmail);
  stranger = strangerSession.client;
  strangerId = strangerSession.id;

  // Builder-equivalent entitlements with a deliberately small recipient cap so the
  // limit boundary is cheap to hit.
  const override = await admin.from('entitlement_overrides').insert({
    user_id: ownerId,
    granted_plan: 'builder',
    max_email_recipients: 3,
    reason: 'phase 7 integration test',
    created_by: ownerId,
  });
  if (override.error) throw override.error;

  slug = `p7${randomUUID().slice(0, 8)}`;
  const created = await owner!.rpc('create_page_with_entitlements', {
    p_slug: slug,
    p_storage_path: `${ownerId}/${slug}.html`,
    p_access_mode: 'email',
    p_password_hash: null,
    p_allowed_emails: ['seed@example.com'],
  });
  if (created.error) throw created.error;
  const { data: row } = await admin.from('pages').select('id').eq('slug', slug).single();
  pageId = row!.id;
});

afterAll(async () => {
  if (!admin) return;
  for (const id of [ownerId, strangerId]) {
    if (id) await admin.auth.admin.deleteUser(id).catch(() => {});
  }
});

test('creating an email page materializes its allowlist as recipient rows', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());

  const { data } = await admin!
    .from('page_recipients')
    .select('email,status')
    .eq('page_id', pageId);
  expect(data).toEqual([{ email: 'seed@example.com', status: 'active' }]);
});

test('adding recipients queues one job each and mirrors allowed_emails', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();

  const { error } = await owner!.rpc('add_page_recipients', {
    p_slug: slug,
    p_emails: ['  First@Example.COM ', 'second@example.com', 'first@example.com'],
  });
  expect(error).toBeNull();

  const { data: recipients } = await admin!
    .from('page_recipients')
    .select('email,status,invitation_status')
    .eq('page_id', pageId)
    .order('email');
  // Normalized, deduped, and the pre-existing seed untouched.
  expect(recipients!.map((r) => r.email)).toEqual([
    'first@example.com',
    'second@example.com',
    'seed@example.com',
  ]);

  const { data: page } = await admin!.from('pages').select('allowed_emails').eq('id', pageId).single();
  expect(page!.allowed_emails).toEqual([
    'first@example.com',
    'second@example.com',
    'seed@example.com',
  ]);

  const { data: jobs } = await admin!.from('invitation_jobs').select('id').eq('page_id', pageId);
  expect(jobs).toHaveLength(2);
});

test('the plan recipient limit is enforced atomically at the boundary', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();

  // Cap is 3 and the seed occupies one, so two more fit and a third does not.
  const ok = await owner!.rpc('add_page_recipients', {
    p_slug: slug,
    p_emails: ['a@example.com', 'b@example.com'],
  });
  expect(ok.error).toBeNull();

  const over = await owner!.rpc('add_page_recipients', {
    p_slug: slug,
    p_emails: ['c@example.com'],
  });
  expect(over.error?.message).toMatch(/recipient limit exceeded/);

  const { count } = await admin!
    .from('page_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('page_id', pageId)
    .eq('status', 'active');
  expect(count).toBe(3);
});

test('concurrent adds cannot race past the limit', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();

  // Two simultaneous adds, each of two addresses, against 2 remaining slots.
  // Without the advisory lock both would read "1 active" and both would commit.
  const [first, second] = await Promise.all([
    owner!.rpc('add_page_recipients', { p_slug: slug, p_emails: ['x1@example.com', 'x2@example.com'] }),
    owner!.rpc('add_page_recipients', { p_slug: slug, p_emails: ['y1@example.com', 'y2@example.com'] }),
  ]);

  const failures = [first, second].filter((r) => r.error);
  expect(failures).toHaveLength(1);
  expect(failures[0].error?.message).toMatch(/recipient limit exceeded/);

  const { count } = await admin!
    .from('page_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('page_id', pageId)
    .eq('status', 'active');
  expect(count).toBe(3);
});

test('a second live job cannot be queued for the same recipient', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();
  await owner!.rpc('add_page_recipients', { p_slug: slug, p_emails: ['dup@example.com'] });

  // Resend twice back to back: the partial unique index keeps exactly one live job,
  // which is what stops a double-clicked resend sending two emails.
  await owner!.rpc('resend_page_recipient', { p_slug: slug, p_email: 'dup@example.com' });
  await owner!.rpc('resend_page_recipient', { p_slug: slug, p_email: 'dup@example.com' });

  const { data: recipient } = await admin!
    .from('page_recipients')
    .select('id')
    .eq('page_id', pageId)
    .eq('email', 'dup@example.com')
    .single();
  const { count } = await admin!
    .from('invitation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', recipient!.id)
    .in('status', ['queued', 'processing']);
  expect(count).toBe(1);
});

test('claiming is exclusive — a second claim gets nothing', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();
  await owner!.rpc('add_page_recipients', { p_slug: slug, p_emails: ['claim@example.com'] });

  const firstClaim = await admin!.rpc('claim_invitation_jobs', { p_page_id: pageId, p_limit: 50 });
  expect(firstClaim.error).toBeNull();
  expect(firstClaim.data).toHaveLength(1);
  expect(firstClaim.data[0].email).toBe('claim@example.com');
  expect(firstClaim.data[0].attempts).toBe(1);

  const secondClaim = await admin!.rpc('claim_invitation_jobs', { p_page_id: pageId, p_limit: 50 });
  expect(secondClaim.data).toHaveLength(0);
});

test('completing a job records the provider id and marks the recipient sent', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();
  await owner!.rpc('add_page_recipients', { p_slug: slug, p_emails: ['done@example.com'] });
  const claim = await admin!.rpc('claim_invitation_jobs', { p_page_id: pageId, p_limit: 50 });

  await admin!.rpc('complete_invitation_job', {
    p_job_id: claim.data[0].job_id,
    p_status: 'sent',
    p_provider_message_id: 'provider-msg-1',
    p_error: null,
  });

  const { data: recipient } = await admin!
    .from('page_recipients')
    .select('invitation_status,last_sent_at')
    .eq('id', claim.data[0].recipient_id)
    .single();
  expect(recipient!.invitation_status).toBe('sent');
  expect(recipient!.last_sent_at).not.toBeNull();

  const { data: job } = await admin!
    .from('invitation_jobs')
    .select('status,provider_message_id')
    .eq('id', claim.data[0].job_id)
    .single();
  expect(job).toMatchObject({ status: 'sent', provider_message_id: 'provider-msg-1' });
});

test('revoking a recipient kills their link and cancels queued delivery', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();
  await owner!.rpc('add_page_recipients', { p_slug: slug, p_emails: ['gone@example.com'] });

  const { data: recipient } = await admin!
    .from('page_recipients')
    .select('id')
    .eq('page_id', pageId)
    .eq('email', 'gone@example.com')
    .single();

  const before = await admin!.rpc('recipient_link_active', {
    p_slug: slug,
    p_recipient_id: recipient!.id,
  });
  expect(before.data).toBe(true);

  const removed = await owner!.rpc('remove_page_recipient', {
    p_slug: slug,
    p_email: 'gone@example.com',
  });
  expect(removed.data).toBe(true);

  const after = await admin!.rpc('recipient_link_active', {
    p_slug: slug,
    p_recipient_id: recipient!.id,
  });
  expect(after.data).toBe(false);

  // The still-queued invitation must not be delivered to someone just removed.
  const { data: jobs } = await admin!
    .from('invitation_jobs')
    .select('status')
    .eq('recipient_id', recipient!.id);
  expect(jobs!.every((j) => j.status === 'failed')).toBe(true);

  const { data: page } = await admin!.from('pages').select('allowed_emails').eq('id', pageId).single();
  expect(page!.allowed_emails).not.toContain('gone@example.com');
});

test('a revoked recipient is never claimed for delivery', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();
  await owner!.rpc('add_page_recipients', { p_slug: slug, p_emails: ['skipme@example.com'] });
  await owner!.rpc('remove_page_recipient', { p_slug: slug, p_email: 'skipme@example.com' });

  const claim = await admin!.rpc('claim_invitation_jobs', { p_page_id: pageId, p_limit: 50 });
  expect(claim.data.map((j: { email: string }) => j.email)).not.toContain('skipme@example.com');
});

test('the last recipient of an email page cannot be removed', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();

  // The CHECK constraint forbids an empty allowlist; this must surface as a
  // readable error, not an opaque constraint violation.
  const { error } = await owner!.rpc('remove_page_recipient', {
    p_slug: slug,
    p_email: 'seed@example.com',
  });
  expect(error?.message).toMatch(/cannot remove the last recipient/);
});

test('a stranger can neither read nor write another owner\'s recipients', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());
  await resetRecipients();

  // RLS hides the rows entirely...
  const { data: visible } = await stranger!.from('page_recipients').select('id');
  expect(visible).toEqual([]);

  // ...and every write path reports the SAME generic message a missing page would,
  // so the endpoint is not an ownership oracle.
  for (const call of [
    stranger!.rpc('add_page_recipients', { p_slug: slug, p_emails: ['evil@example.com'] }),
    stranger!.rpc('remove_page_recipient', { p_slug: slug, p_email: 'seed@example.com' }),
    stranger!.rpc('resend_page_recipient', { p_slug: slug, p_email: 'seed@example.com' }),
  ]) {
    const { error } = await call;
    expect(error?.message).toMatch(/page not found/);
  }
});

test('service-tier dispatch functions are not executable by an ordinary user', async (ctx) => {
  if (!hasEnv || !reachable) return void (console.warn(skipReason()), ctx.skip());

  const claim = await owner!.rpc('claim_invitation_jobs', { p_page_id: pageId, p_limit: 10 });
  expect(claim.error?.message).toMatch(/permission denied/i);

  const complete = await owner!.rpc('complete_invitation_job', {
    p_job_id: randomUUID(),
    p_status: 'sent',
    p_provider_message_id: null,
    p_error: null,
  });
  expect(complete.error?.message).toMatch(/permission denied/i);

  const active = await owner!.rpc('recipient_link_active', {
    p_slug: slug,
    p_recipient_id: randomUUID(),
  });
  expect(active.error?.message).toMatch(/permission denied/i);
});
