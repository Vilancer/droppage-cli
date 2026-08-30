import type { Command } from 'commander';
import { buildShareUrl, resolveShareBaseUrl } from '../lib/share-url.js';
import {
  PAGE_TABLE_ALIGN,
  PAGE_TABLE_HEADERS,
  pageTableCells,
  renderTable,
} from '../lib/table.js';
import { createSupabaseClient } from '../lib/supabase.js';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import { listPages, type PageRow } from '../services/pages.js';

type PreviewMap = Map<string, string>;

async function fetchPreviewUrls(pages: PageRow[]): Promise<PreviewMap | null> {
  if (pages.length === 0) return new Map();
  const supabase = createSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  const response = await fetch(`${resolveShareBaseUrl()}/api/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ slugs: pages.map((page) => page.slug) }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    previews?: { slug?: unknown; url?: unknown }[];
  };
  return new Map(
    (body.previews ?? [])
      .filter(
        (preview): preview is { slug: string; url: string } =>
          typeof preview.slug === 'string' && typeof preview.url === 'string',
      )
      .map((preview) => [preview.slug, preview.url]),
  );
}

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
              pages.map((page) => ({
                slug: page.slug,
                url: buildShareUrl(page.slug),
                access_mode: page.access_mode,
                allowed_emails: page.allowed_emails ?? [],
                view_count: page.view_count,
                created_at: page.created_at,
                last_viewed_at: page.last_viewed_at,
                ...(options.preview
                  ? { preview_url: previews?.get(page.slug) ?? null }
                  : {}),
              })),
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
