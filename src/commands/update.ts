import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { validateHtmlUpload } from '../lib/validate-html.js';
import { parseExpiry } from '../lib/duration.js';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import { attachLocalImages, pruneUnusedImages } from '../services/page-images.js';
import { assertUpdateAllowed, setPageExpiry, updatePageHtml } from '../services/pages.js';

export function registerUpdate(program: Command): void {
  program
    .command('update')
    .description('Replace the HTML behind an existing page URL (its local images and videos are uploaded too)')
    .argument('<slug>', 'slug of the page to update')
    .argument('<file>', 'path to replacement .html file')
    .option('--expires <when>', 'set when the page expires: 30m, 12h, 7d, 2w, a date, or never')
    .action(async (slug: string, file: string, options: { expires?: string }) => {
      let user;
      try {
        user = await requireAuth();
      } catch (err) {
        if (err instanceof AuthRequiredError) return;
        throw err;
      }

      try {
        const expiresAt = options.expires === undefined ? undefined : parseExpiry(options.expires);
        console.error(`droppage: updating ${slug} from ${file}...`);
        await assertUpdateAllowed(slug);
        // Reject a bad file before any image is uploaded for it.
        validateHtmlUpload(file, await readFile(file));
        const { html } = await attachLocalImages(file, slug, { update: true });
        const result = await updatePageHtml({ slug, file, user, html });
        const removed = await pruneUnusedImages(slug, html);
        if (removed) console.error(`droppage: removed ${removed} image or video file(s) the page no longer uses`);
        if (expiresAt !== undefined) {
          await setPageExpiry(slug, expiresAt);
          console.error(expiresAt ? `droppage: expires ${expiresAt.toISOString()}` : 'droppage: never expires');
        }
        console.error(`droppage: updated ${slug}`);
        process.stdout.write(result.url + '\n');
      } catch (err) {
        process.exitCode = 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`droppage: update failed: ${message}`);
        if (/quota reached|limit reached|require (Starter|Builder)/i.test(message)) {
          console.error('run `droppage quota` to see your limits');
        }
      }
    });

  program
    .command('expire')
    .description('Set when a page (and its images and videos) is deleted: 30m, 12h, 7d, 2w, a date, or never')
    .argument('<slug>', 'slug of the page')
    .argument('<when>', 'e.g. 7d, 2026-12-31, or never')
    .action(async (slug: string, when: string) => {
      try {
        await requireAuth();
      } catch (err) {
        if (err instanceof AuthRequiredError) return;
        throw err;
      }
      try {
        const expiresAt = parseExpiry(when);
        await setPageExpiry(slug, expiresAt);
        console.error(expiresAt ? `droppage: ${slug} expires ${expiresAt.toISOString()}` : `droppage: ${slug} never expires`);
      } catch (err) {
        process.exitCode = 1;
        console.error(`droppage: expire failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
}
