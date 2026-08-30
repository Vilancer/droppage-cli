import { readFile } from 'node:fs/promises';
import type { User } from '@supabase/supabase-js';
import { buildShareUrl } from '../lib/share-url.js';
import { createSlug } from '../lib/slug.js';
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
}): Promise<string> {
  const bytes = await readFile(file);

  // Pure validation BEFORE any network call (PUB-03 / D-08). Throws on hard
  // failures (bad extension, empty, over cap, non-HTML content).
  const { warnings } = validateHtmlUpload(file, bytes);
  for (const w of warnings) console.error(`droppage: warning: ${w}`);

  const supabase = createSupabaseClient();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const slug = createSlug();
    // Object path MUST match the Plan 01 storage.objects RLS predicate
    // `(storage.foldername(name))[1] = auth.jwt()->>'sub'` (Pitfall 3).
    const storagePath = `${user.id}/${slug}.html`;

    const up = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: 'text/html; charset=utf-8',
      upsert: false,
    });
    if (up.error) throw up.error;

    // Exactly one access-mode payload column is written so the Plan 01
    // pages_access_mode_consistency CHECK is satisfied: email/private ⇒
    // allowed_emails non-empty + password_hash NULL; password ⇒ password_hash +
    // allowed_emails NULL; public ⇒ neither. The command passes the resolved
    // accessMode (D-06); when omitted it is derived for backward compatibility.
    const resolvedMode: AccessMode =
      accessMode ??
      (allowedEmails ? 'email' : passwordHash ? 'password' : 'public');
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
    if (!ins.error) return buildShareUrl(slug);

    // ANY failed insert (slug collision, RLS denial, check-constraint, transient
    // network error) leaves the just-uploaded object orphaned in the private
    // bucket with no pages row and no reclamation path (no delete/gc exists yet).
    // Remove it BEFORE deciding what to do (Pattern 3 order — no leaked objects),
    // and surface removal failures instead of silently leaking.
    const rm = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (rm.error) {
      console.error(
        `droppage: warning: could not remove orphan ${storagePath}: ${rm.error.message}`,
      );
    }
    // Slug UNIQUE violation → retry with a fresh slug; any other error is fatal.
    if (ins.error.code === '23505') continue;
    throw ins.error;
  }

  throw new Error(
    `Could not allocate a unique slug after ${MAX_RETRIES} attempts`,
  );
}
