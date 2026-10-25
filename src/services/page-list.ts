import { buildShareUrl, resolveShareBaseUrl } from '../lib/share-url.js';
import { createSupabaseClient } from '../lib/supabase.js';
import type { PageRow } from './pages.js';

/** slug → temporary preview URL that does not count as a view. */
export type PreviewMap = Map<string, string>;

/** Preview URLs for the given pages, or null when the server can't give them. */
export async function fetchPreviewUrls(pages: PageRow[]): Promise<PreviewMap | null> {
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

/** One `list --json` row. `previews` given (even null) adds `preview_url`. */
export function pageJson(page: PageRow, previews?: PreviewMap | null) {
  return {
    slug: page.slug,
    url: buildShareUrl(page.slug),
    access_mode: page.access_mode,
    allowed_emails: page.allowed_emails ?? [],
    view_count: page.view_count,
    created_at: page.created_at,
    last_viewed_at: page.last_viewed_at,
    expires_at: page.expires_at ?? null,
    ...(previews !== undefined ? { preview_url: previews?.get(page.slug) ?? null } : {}),
  };
}
