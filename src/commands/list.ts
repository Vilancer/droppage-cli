import type { Command } from 'commander';
import {
  PAGE_TABLE_ALIGN,
  PAGE_TABLE_HEADERS,
  pageTableCells,
  renderTable,
} from '../lib/table.js';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import { fetchPreviewUrls, pageJson, type PreviewMap } from '../services/page-list.js';
import { listPages } from '../services/pages.js';

export function registerList(program: Command): void {
  program
    .command('list')
    .description(
      'List your published pages. VIEWS is a raw hit count, including refreshes and crawlers, not unique visitors.',
    )
    // D-01: structured stdout for agents/CI while the default remains a table.
    .option('--json', 'print a machine-readable JSON array')
    .option('--preview', 'include temporary preview URLs that do not increment views')
    .action(async (options: { json?: boolean; preview?: boolean }) => {
      let user;
      try {
        user = await requireAuth();
      } catch (err) {
        if (err instanceof AuthRequiredError) return;
        throw err;
      }
      try {
        const pages = await listPages(user);
        let previews: PreviewMap | null = null;
        if (options.preview) {
          try {
            previews = await fetchPreviewUrls(pages);
          } catch {
            previews = null;
          }
          if (!previews) {
            console.error(
              'droppage: warning: could not fetch preview URLs; showing pages without previews.',
            );
          }
        }
        if (pages.length === 0) {
          console.error(
            'droppage: no pages yet. Publish one with `droppage upload <file.html>`.',
          );
        }
        if (options.json) {
          process.stdout.write(
            JSON.stringify(
              pages.map((page) => pageJson(page, options.preview ? previews : undefined)),
              null,
              2,
            ) + '\n',
          );
          return;
        }
        if (pages.length > 0) {
          const headers = options.preview
            ? [...PAGE_TABLE_HEADERS, 'PREVIEW']
            : PAGE_TABLE_HEADERS;
          const align = options.preview
            ? [...PAGE_TABLE_ALIGN, 'left' as const]
            : PAGE_TABLE_ALIGN;
          process.stdout.write(
            renderTable(
              headers,
              pages.map((page) =>
                options.preview
                  ? [...pageTableCells(page), previews?.get(page.slug) ?? '—']
                  : pageTableCells(page),
              ),
              align,
            ) + '\n',
          );
        }
      } catch (err) {
        console.error(
          `droppage: list failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });
}
