/**
 * Publishing shared by the CLI commands and the MCP server, so both run the same
 * checks in the same order. Progress and warnings go through `notify` (stderr on
 * the CLI); results are returned, never printed.
 */
import { readFile } from 'node:fs/promises';
import type { User } from '@supabase/supabase-js';

import { cleanEmails } from '../lib/emails.js';
import { notify } from '../lib/notify.js';
import { validateHtmlUpload } from '../lib/validate-html.js';
import type { UploadedImage } from './images.js';
import { attachLocalImages, hasLocalImages, pruneUnusedImages } from './page-images.js';
import { assertUpdateAllowed, setPageExpiry, updatePageHtml } from './pages.js';
import { type AccessMode, upload } from './upload.js';


export type ResolvedAccess = {
  accessMode: AccessMode;
  allowedEmails?: string[];
  passwordHash?: string;
};

/**
 * Turn the requested access mode into what `upload()` stores, validating
 * before any network call. email: a cleaned, validated allowlist (D-07).
 * private: a one-address allowlist with the owner's own email (D-04). password:
 * the caller's bcrypt hash; the plaintext never reaches this module.
 */
export function resolveAccess(
  user: User,
  accessMode: AccessMode,
  { emails, passwordHash }: { emails?: string[]; passwordHash?: string } = {},
): ResolvedAccess {
  switch (accessMode) {
    case 'public':
      return { accessMode };
    case 'password':
      if (!passwordHash) throw new Error('a password page needs a password');
      return { accessMode, passwordHash };
    case 'email':
      return {
        accessMode,
        allowedEmails: cleanEmails(emails ?? []),
      };
    case 'private': {
      const ownerEmail = user.email?.trim().toLowerCase();
      if (!ownerEmail) throw new Error('a private page needs an email on your account, but none was found');
      return { accessMode, allowedEmails: [ownerEmail] };
    }
  }
}

/**
 * Publish an HTML file as a new page. Local images and videos it references are
 * uploaded to the page and their links rewritten once the slug is chosen.
 */
export async function publishPage({
  file,
  user,
  access,
  expiresAt,
}: {
  file: string;
  user: User;
  access: ResolvedAccess;
  expiresAt?: Date;
}): Promise<{ url: string; media: UploadedImage[] }> {
  let media: UploadedImage[] = [];
  const prepare = (await hasLocalImages(file))
    ? async (slug: string) => {
        const attached = await attachLocalImages(file, slug);
        media = attached.uploaded;
        return attached.html;
      }
    : undefined;
  const url = await upload({ file, user, ...access, prepare, expiresAt });
  return { url, media };
}

/**
 * Replace the HTML behind an existing page: the server's update check first, so
 * nothing (images included) is uploaded for an update that would be refused;
 * then the file check, its local images, the HTML, the clean-up of images the
 * page no longer uses, and the expiry (`undefined` leaves it, `null` clears it).
 */
export async function updatePage({
  slug,
  file,
  user,
  expiresAt,
}: {
  slug: string;
  file: string;
  user: User;
  expiresAt?: Date | null;
}): Promise<{ url: string; media: UploadedImage[]; removed: number }> {
  await assertUpdateAllowed(slug);
  validateHtmlUpload(file, await readFile(file));
  const { html, uploaded } = await attachLocalImages(file, slug, { update: true });
  const result = await updatePageHtml({ slug, file, user, html });
  const removed = await pruneUnusedImages(slug, html);
  if (removed) notify('info', `removed ${removed} image or video file(s) the page no longer uses`);
  if (expiresAt !== undefined) {
    await setPageExpiry(slug, expiresAt);
    notify('info', expiresAt ? `expires ${expiresAt.toISOString()}` : 'never expires');
  }
  return { url: result.url, media: uploaded, removed };
}
