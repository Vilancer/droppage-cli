import { readFile } from 'node:fs/promises';
import type { User } from '@supabase/supabase-js';
import { buildShareUrl } from '../lib/share-url.js';
import { notify } from '../lib/notify.js';
import { createSlug } from '../lib/slug.js';
import { asError } from '../lib/supabase-error.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { validateHtmlUpload } from '../lib/validate-html.js';

const BUCKET = 'pages';

/** The four access modes a page can carry. Exactly one is written per row so the
 * pages_access_mode_consistency CHECK is satisfied (D-06). `public` is the default. */
export type AccessMode = 'public' | 'password' | 'email' | 'private';

/** Bounded slug-collision retry limit (PUB-01 / D-09). 10-char nanoid over a
 * 64-char alphabet is ~60 bits of entropy — a collision is astronomically
 * unlikely, but the DB UNIQUE(slug) constraint is the authority and this
 * bounded retry keeps the CLI correct without ever looping forever. */
export const MAX_RETRIES = 5;

/**
 * Publish an HTML file and return its canonical share URL.
 *
 * Flow (RESEARCH Code Example 1): `readFile` →
 * {@link validateHtmlUpload} (pure, runs BEFORE any network call) → bounded
 * loop of `createSlug()` → private-bucket upload at `{owner_id}/{slug}.html`
 * → `pages` insert → on a `23505` unique_violation, remove the orphaned object
 * and retry with a fresh slug.
 *
 * The caller (the `upload` command) is the single auth gate: it resolves the
 * publisher via `requireAuth()` once and threads the resolved `user` in here
 * (WR-04 — no second `getUser()` round-trip). Uses ONLY
 * {@link createSupabaseClient} (anon key + publisher JWT, RLS-scoped — never a
 * service-role key: ARCH-02/D-03). Every publish is a NEW immutable link
 * (`upsert:false`, D-09). Validation warnings and progress go to stderr; this
 * function returns the bare share URL only (D-10).
 */
export async function upload({
  file,
  user,
  passwordHash,
  allowedEmails,
  accessMode,
  prepare,
  expiresAt,
}: {
  file: string;
  user: User;
  /** When present, the page is written as access_mode='password' with this
   * bcrypt hash (D-04). Omitted → an unchanged public insert. The plaintext is
   * hashed by the caller and never reaches this service. */
  passwordHash?: string;
  /** When present (non-empty), the allowlist for an email/private page — this
   * normalized (trim+lowercase) array (ACC-02 / ACC-03 / D-08a). supabase-js maps
   * the string[] → Postgres text[] natively. When set the row carries NO
   * password_hash (the pages_access_mode_consistency CHECK requires it NULL).
   * Written via the anon+JWT (RLS-scoped) client — never service-role (ARCH-02). */
  allowedEmails?: string[];
  /** The resolved access mode from the command (D-06 — exactly one). When
   * omitted it is derived (allowedEmails ⇒ email, passwordHash ⇒ password, else
   * public) so existing callers keep working. `private` and `email` both carry
   * an allowlist; the command distinguishes them (private = owner self-allowlist). */
  accessMode?: AccessMode;
  /** Called once the slug for an attempt is chosen (after the server preflight),
   * before the HTML is stored: uploads the page's images for that slug and
   * returns the HTML with its image links rewritten. */
  prepare?: (slug: string) => Promise<Buffer>;
  /** When the page should expire (set right after it is created). */
  expiresAt?: Date;
}): Promise<string> {
  let bytes: Buffer = await readFile(file);

  // Pure validation BEFORE any network call (PUB-03 / D-08). Throws on hard
  // failures (bad extension, empty, over cap, non-HTML content).
  const { warnings } = validateHtmlUpload(file, bytes);
  // With local images, warn about the HTML as published (links rewritten), not
  // about references that are about to be uploaded.
  if (!prepare) for (const w of warnings) notify('warning', w);

  const supabase = createSupabaseClient();

  // Exactly one access-mode payload column is written so the Plan 01
  // pages_access_mode_consistency CHECK is satisfied: email/private ⇒
  // allowed_emails non-empty + password_hash NULL; password ⇒ password_hash +
  // allowed_emails NULL; public ⇒ neither. The command passes the resolved
  // accessMode (D-06); when omitted it is derived for backward compatibility.
  // Depends only on the arguments, not the slug, so it is resolved once.
  const resolvedMode: AccessMode =
    accessMode ??
    (allowedEmails ? 'email' : passwordHash ? 'password' : 'public');

  // Server-side preflight BEFORE the storage write, mirroring updatePageHtml.
  // The storage.objects insert policy gates on a bare boolean, so a plan-limit
  // denial there surfaces Postgres's generic RLS message and the server's own
  // wording never reaches the publisher. Asking Postgres first fixes that.
  // Postgres stays authoritative: create_page_with_entitlements re-checks under
  // an advisory lock, so a race here changes the message, never the outcome.
  // Runs once per upload, not once per slug attempt.
  const preflight = await supabase.rpc('assert_page_create_allowed', {
    p_access_mode: resolvedMode,
    p_recipient_count: allowedEmails?.length ?? 0,
  });
  if (preflight.error) throw asError(preflight.error);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const slug = createSlug();
    // Object path MUST match the Plan 01 storage.objects RLS predicate
    // `(storage.foldername(name))[1] = auth.jwt()->>'sub'` (Pitfall 3).
    const storagePath = `${user.id}/${slug}.html`;
    if (prepare) {
      bytes = await prepare(slug);
      if (attempt === 0) for (const w of validateHtmlUpload(file, bytes).warnings) notify('warning', w);
    }

    const up = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: 'text/html; charset=utf-8',
      upsert: false,
    });
    if (up.error) {
      // The preflight already passed, so a policy denial here is a race (a
      // concurrent upload taking the last slot) or an unrelated policy clause.
      // Keep the server's own text verbatim, claim no specific cause, and point
      // at the command that can explain limits — no limit arithmetic or plan
      // knowledge belongs in the CLI.
      if (/row-level security/i.test(up.error.message)) {
        throw new Error(
          `the server rejected this upload: ${up.error.message}. This can happen when an account limit is reached while an upload is in flight — run \`droppage quota\` to check your limits.`,
        );
      }
      throw asError(up.error);
    }

    // Postgres is authoritative for page, monthly, and feature quotas. Direct
    // INSERT is revoked from authenticated users, so skipping a CLI preflight
    // cannot bypass the entitlement boundary.
    const ins = await supabase.rpc('create_page_with_entitlements', {
      p_slug: slug,
      p_storage_path: storagePath,
      p_access_mode: resolvedMode,
      p_password_hash: resolvedMode === 'password' ? passwordHash : null,
      p_allowed_emails: allowedEmails ?? null,
    });
    if (!ins.error) {
      if (expiresAt) {
        const expiry = await supabase.rpc('set_page_expiry', { p_slug: slug, p_expires_at: expiresAt.toISOString() });
        if (expiry.error) {
          throw new Error(
            `published ${buildShareUrl(slug)} but could not set its expiry (${expiry.error.message}); set it with \`droppage expire ${slug} <when>\` or delete it`,
          );
        }
      }
      return buildShareUrl(slug);
    }

    // ANY failed insert (slug collision, RLS denial, check-constraint, transient
    // network error) leaves the just-uploaded object orphaned in the private
    // bucket with no pages row and no reclamation path (no delete/gc exists yet).
    // Remove it BEFORE deciding what to do (Pattern 3 order — no leaked objects),
    // and surface removal failures instead of silently leaking.
    const rm = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (rm.error) {
      notify('warning', `could not remove orphan ${storagePath}: ${rm.error.message}`);
    }
    // Slug UNIQUE violation → retry with a fresh slug; any other error is fatal.
    if (ins.error.code === '23505') continue;
    throw asError(ins.error);
  }

  throw new Error(
    `Could not allocate a unique slug after ${MAX_RETRIES} attempts`,
  );
}
