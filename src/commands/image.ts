import type { Command } from 'commander';

import { formatDateCell, renderTable } from '../lib/table.js';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import { deleteImage, listImages, uploadImage } from '../services/images.js';

// Decimal units (1 MB = 1,000,000 bytes), the same as plans, quota and the
// account page, so a 50 MB page budget reads "50 MB".
export function formatBytes(value: number): string {
  if (value < 1000) return `${value} B`;
  if (value < 1_000_000) return `${Math.round(value / 1000)} KB`;
  if (value < 1_000_000_000) return `${Number((value / 1_000_000).toFixed(1))} MB`;
  return `${Number((value / 1_000_000_000).toFixed(2))} GB`;
}

async function signedIn(): Promise<boolean> {
  try {
    await requireAuth();
    return true;
  } catch (err) {
    if (err instanceof AuthRequiredError) return false;
    throw err;
  }
}

function fail(err: unknown): void {
  console.error(`droppage: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}

/**
 * `droppage image upload|list|delete`: host images for HTML pages.
 * Output contract: `upload` prints only the URL(s) on stdout, `--json` prints
 * only JSON; everything human goes to stderr.
 */
export function registerImage(program: Command): void {
  const image = program
    .command('image')
    .description('Images that belong to a page (uploaded automatically by upload/update from local files the HTML references)');

  image
    .command('upload')
    .description('Add images to one of your pages and print their URLs (PNG, JPEG, GIF, WebP, AVIF, SVG; up to 4 MB each)')
    .argument('<files...>', 'image files')
    .requiredOption('--page <slug>', 'the page the images belong to (they go when it is deleted or expires)')
    .option('--json', 'print the results as JSON')
    .action(async (files: string[], options: { page: string; json?: boolean }) => {
      if (!(await signedIn())) return;
      const results = [];
      for (const file of files) {
        try {
          const uploaded = await uploadImage(file, options.page);
          results.push({ file, ...uploaded });
          if (!options.json) {
            process.stdout.write(`${uploaded.url}\n`);
            if (uploaded.existing) console.error(`droppage: ${file} is already on this page; same URL.`);
          }
        } catch (err) {
          fail(new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
      if (options.json) process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    });

  image
    .command('list')
    .description("List your pages' images (one page with --page, including its image budget)")
    .option('--page <slug>', 'only this page')
    .option('--json', 'print the list as JSON')
    .action(async (options: { page?: string; json?: boolean }) => {
      if (!(await signedIn())) return;
      try {
        const list = await listImages(options.page);
        if (options.json) {
          process.stdout.write(JSON.stringify(list, null, 2) + '\n');
          return;
        }
        if (list.images.length === 0) {
          console.error('droppage: no images. `droppage upload page.html` uploads the images the page uses.');
        } else {
          process.stdout.write(renderTable(
            ['ID', 'PAGE', 'NAME', 'SIZE', 'UPLOADED', 'URL'],
            list.images.map((row) => [row.id, row.page ?? '', row.name ?? '', formatBytes(row.bytes), formatDateCell(row.created_at), row.url]),
            ['left', 'left', 'left', 'right', 'left', 'left'],
          ) + '\n');
        }
        if (list.page) {
          const limit = list.page.limit_bytes === null ? 'unlimited' : formatBytes(list.page.limit_bytes);
          console.error(`droppage: images on ${list.page.slug}: ${formatBytes(list.page.used_bytes)} of ${limit} per page.`);
        }
      } catch (err) {
        fail(err);
      }
    });

  image
    .command('delete')
    .description('Delete images (by id or URL); they stop being served within 5 minutes; a browser that already loaded one may keep it up to a day')
    .argument('<images...>', 'image ids or URLs')
    .action(async (ids: string[]) => {
      if (!(await signedIn())) return;
      for (const value of ids) {
        try {
          const id = await deleteImage(value);
          console.error(`droppage: deleted image ${id}`);
        } catch (err) {
          fail(new Error(`${value}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    });
}
