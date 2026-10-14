import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);
// The real `src` attribute of <img>/<source>: preceded by whitespace, so
// `data-src` never matches. Groups: 1 = everything before the value's opening
// quote, 2 = the quote, 3 = the value.
const SRC_RE = /(<(?:img|source)\b[^>]*?\ssrc\s*=\s*)(["'])([^"']+)\2/gi;

export type LocalImage = { ref: string; path: string };

function inside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return !!rel && !rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel);
}

/**
 * The local image files a page uses: `<img src="chart.png">`, relative to the
 * HTML file and inside its folder, checked on real paths so a symlink can't
 * point elsewhere. URLs, data: URIs, absolute paths and `../` references are
 * skipped, so publishing someone else's HTML can never upload a file from
 * elsewhere on this machine. Each distinct reference once, in document order.
 */
export function findLocalImages(html: string, htmlFile: string): LocalImage[] {
  const base = dirname(resolve(htmlFile));
  let realBase: string;
  try {
    realBase = realpathSync(base);
  } catch {
    return [];
  }
  const seen = new Map<string, LocalImage>();
  for (const match of html.matchAll(SRC_RE)) {
    const ref = match[3].trim();
    if (seen.has(ref) || /^(?:[a-z][a-z0-9+.-]*:|\/|\\|#)/i.test(ref)) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(ref.split(/[?#]/)[0]);
    } catch {
      continue;
    }
    if (!IMAGE_EXTS.has(extname(decoded).toLowerCase())) continue;
    const path = resolve(base, decoded);
    if (!inside(base, path) || !existsSync(path)) continue;
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      continue;
    }
    if (!inside(realBase, real) || !statSync(real).isFile()) continue;
    seen.set(ref, { ref, path: real });
  }
  return [...seen.values()];
}

/** Point every `src` that used a local reference at its hosted URL; nothing else changes. */
export function rewriteImageRefs(html: string, urls: Map<string, string>): string {
  return html.replace(SRC_RE, (whole, before: string, quote: string, ref: string) => {
    const url = urls.get(ref.trim());
    return url ? `${before}${quote}${url}${quote}` : whole;
  });
}
