import { extname } from 'node:path';

import { resolveShareBaseUrl } from './share-url.js';

/** Maximum accepted upload size — 5 MB, comfortably under Supabase's 6 MB
 * standard-upload threshold (D-08 / RESEARCH Pattern 4). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Allowed (lowercased) file extensions for an HTML upload. */
const ALLOWED_EXTENSIONS = new Set(['.html', '.htm']);

/** How many leading bytes to decode for the light content sniff. */
const SNIFF_BYTES = 4096;

/** Case-insensitive markers that make a byte stream "look like" HTML. */
const HTML_MARKERS = [
  /<!doctype\s+html/i,
  /<html[\s>]/i,
  /<head[\s>]/i,
  /<body[\s>]/i,
  /<div[\s>]/i,
];

/** Relative / root-relative asset references that will not resolve in a
 * single-file share (Pitfall 9 / D-08). Matches `src`/`href` values that
 * begin with `./`, `../`, or `/` (but not `//` protocol-relative, handled
 * separately). */
// `/i/<id>.<ext>` is a droppage-hosted page image: it resolves on the share
// origin, so it is not a broken relative asset.
const RELATIVE_ASSET_RE =
  /(?:src|href)\s*=\s*["'](?:\.\.?\/|\/(?!\/)(?!i\/[A-Za-z0-9]{12}\.[a-z]+["']))/i;

/** Protocol-relative or absolute external asset references (`//host`,
 * `http://`, `https://`). These also will not always resolve as authored. */
const EXTERNAL_ASSET_RE = /(?:src|href)\s*=\s*["']((?:\/\/|https?:\/\/)[^"']*)/gi;

/** Images hosted with `droppage image upload` are public and stable: not worth a warning. */
function isHostedImage(url: string): boolean {
  return url.startsWith(`${resolveShareBaseUrl()}/i/`);
}

/** Result of a successful upload validation. */
export interface ValidateHtmlResult {
  ok: true;
  /** Non-fatal advisories (e.g. relative assets); the upload still proceeds. */
  warnings: string[];
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * Pure, dependency-light validator for an HTML upload (PUB-03 / D-08).
 *
 * Runs BEFORE any network call. Throws {@link Error} on hard failures
 * (bad extension, empty, over the size cap, or content that does not look
 * like HTML — e.g. a `.html`-renamed PDF). Non-fatal issues (references to
 * relative/external assets that will not resolve in a single-file share) are
 * returned as `warnings` and never throw.
 *
 * @param path - The user-supplied file path (only its extension is inspected).
 * @param bytes - The raw file contents. No filesystem/network access occurs.
 * @returns `{ ok: true, warnings }` when the upload is acceptable.
 * @throws Error when the file is not a valid HTML upload.
 */
export function validateHtmlUpload(
  path: string,
  bytes: Buffer | Uint8Array,
): ValidateHtmlResult {
  const ext = extname(path).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file type: ${path} (expected .html or .htm)`,
    );
  }

  if (bytes.length === 0) {
    throw new Error(`File is empty: ${path}`);
  }

  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File too large: ${formatBytes(bytes.length)} (max ${formatBytes(
        MAX_UPLOAD_BYTES,
      )})`,
    );
  }

  // Light content sniff over a leading slice — rejects a renamed non-HTML file.
  const head = Buffer.from(
    bytes.subarray(0, Math.min(bytes.length, SNIFF_BYTES)),
  ).toString('utf8');
  const looksLikeHtml = HTML_MARKERS.some((re) => re.test(head));
  if (!looksLikeHtml) {
    throw new Error(
      `Content does not look like HTML: ${path} (no <!doctype html>, <html>, or <body> found)`,
    );
  }

  // Non-fatal warnings: assets that will not resolve in a single-file share.
  const warnings: string[] = [];
  const body = bytes.length <= SNIFF_BYTES
    ? head
    : Buffer.from(bytes).toString('utf8');
  if (RELATIVE_ASSET_RE.test(body)) {
    warnings.push(
      'HTML references relative assets (src/href beginning with ./ or /); ' +
        'they will not resolve in a single-file share. Inline them for a self-contained page.',
    );
  }
  const external = [...body.matchAll(EXTERNAL_ASSET_RE)].map((m) => m[1]).filter((url) => !isHostedImage(url));
  if (external.length > 0) {
    warnings.push(
      'HTML references external assets (//host or http(s)://); ' +
        'they must be publicly reachable to render in the shared page.',
    );
  }

  return { ok: true, warnings };
}
