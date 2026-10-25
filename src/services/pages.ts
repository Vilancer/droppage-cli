import { readFile } from 'node:fs/promises';
import type { User } from '@supabase/supabase-js';
import { buildShareUrl } from '../lib/share-url.js';
import { notify } from '../lib/notify.js';
import { asError } from '../lib/supabase-error.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { validateHtmlUpload } from '../lib/validate-html.js';
import type { AccessMode } from './upload.js';

const BUCKET = 'pages';
const NOT_FOUND_MESSAGE = 'page not found or already deleted';

export type { AccessMode };

export type PageRow = {
  slug: string;
  access_mode: AccessMode;
  allowed_emails: string[] | null;
  view_count: number;
  created_at: string;
  last_viewed_at: string | null;
  expires_at: string | null;
};

type DeleteOk = { ok: true; blobWasAbsent: boolean };
type DeleteFail = { ok: false; partial: boolean; message: string };
export type DeletePageResult = DeleteOk | DeleteFail;

export type UpdatePageResult = {
  slug: string;
  url: string;
  storagePath: string;
};

export async function listPages(user: User): Promise<PageRow[]> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('pages')
    .select(
      'slug, access_mode, allowed_emails, view_count, created_at, last_viewed_at, expires_at',
    )
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PageRow[];
}

export async function deletePage(
  slug: string,
  user: User,
): Promise<DeletePageResult> {
  const supabase = createSupabaseClient();
  const { data: row, error: selectError } = await supabase
    .from('pages')
    .select('slug, storage_path')
    .eq('slug', slug)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!row) return { ok: false, partial: false, message: NOT_FOUND_MESSAGE };

  const storagePath = (row as { storage_path: string }).storage_path;
  const removed = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (removed.error) {
    return {
      ok: false,
      partial: false,
      message: `could not remove ${slug}: ${removed.error.message}. Nothing was deleted and the link still works.`,
    };
  }

  const blobWasAbsent = (removed.data ?? []).length === 0;
  const deleted = await supabase
    .from('pages')
    .delete()
    .eq('slug', slug)
    .eq('owner_id', user.id)
    .select('slug');
  const deletedCount = deleted.data?.length ?? 0;
  if (deleted.error || deletedCount === 0) {
    if (blobWasAbsent && deletedCount === 0 && !deleted.error) {
      return { ok: false, partial: false, message: NOT_FOUND_MESSAGE };
    }
    return {
      ok: false,
      partial: true,
      message: `stored HTML for ${slug} was removed, so the link is dead, but the metadata row could not be deleted (${deleted.error?.message ?? 'zero rows affected'}). Re-run droppage delete ${slug}.`,
    };
  }

  if (blobWasAbsent) {
    notify('warning', `no stored HTML was found at ${storagePath}; deleted metadata row for ${slug}.`);
  }
  return { ok: true, blobWasAbsent };
}

export async function updatePageHtml({
  slug,
  file,
  user,
  html,
}: {
  slug: string;
  file: string;
  user: User;
  /** The HTML to store, when the caller already rewrote it (image links). */
  html?: Buffer;
}): Promise<UpdatePageResult> {
  const bytes = html ?? (await readFile(file));
  const { warnings } = validateHtmlUpload(file, bytes);
  for (const warning of warnings) notify('warning', warning);

  const supabase = createSupabaseClient();
  const preflight = await supabase.rpc('assert_page_update_allowed', {
    p_slug: slug,
  });
  if (preflight.error) throw asError(preflight.error);
  const { data: row, error: selectError } = await supabase
    .from('pages')
    .select('slug, storage_path')
    .eq('slug', slug)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!row) throw new Error('page not found or not owned');

  const storagePath = (row as { storage_path: string }).storage_path;
  if (!storagePath.startsWith(`${user.id}/`)) {
    throw new Error('page storage path is not owner-scoped');
  }

  const replaced = await supabase.storage
    .from(BUCKET)
    .update(storagePath, bytes, {
      contentType: 'text/html; charset=utf-8',
    });
  if (replaced.error) {
    throw new Error(
      `could not replace stored HTML: ${replaced.error.message}. The existing link may still serve the previous content.`,
    );
  }

  return {
    slug,
    storagePath,
    url: buildShareUrl(slug),
  };
}

/** Set (a Date) or clear (null) when a page expires. */
export async function setPageExpiry(slug: string, expiresAt: Date | null): Promise<void> {
  const supabase = createSupabaseClient();
  const { error } = await supabase.rpc('set_page_expiry', {
    p_slug: slug,
    p_expires_at: expiresAt ? expiresAt.toISOString() : null,
  });
  if (error) throw asError(error);
}

/** The server's update check, so nothing (images included) is uploaded for an update that would be refused. */
export async function assertUpdateAllowed(slug: string): Promise<void> {
  const { error } = await createSupabaseClient().rpc('assert_page_update_allowed', { p_slug: slug });
  if (error) throw asError(error);
}
