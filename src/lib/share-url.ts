/** Canonical production share origin for droppage links. */
export const DEFAULT_SHARE_BASE_URL = 'https://droppage.dev';

/**
 * Resolve the share origin. Production defaults to droppage.dev; dev/test/staging
 * can keep DuckDNS or a local serve origin via DROPPAGE_SHARE_BASE_URL.
 */
export function resolveShareBaseUrl(): string {
  const raw = process.env.DROPPAGE_SHARE_BASE_URL?.trim();
  return (raw || DEFAULT_SHARE_BASE_URL).replace(/\/+$/, '');
}

export function buildShareUrl(slug: string): string {
  return `${resolveShareBaseUrl()}/p/${slug}`;
}
