import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm']);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);
// A real attribute of one of `tags`: preceded by whitespace, so `data-src` and
// `data-srcset` never match. Groups: 1 = everything before the value's opening
// quote, 2 = the quote, 3 = the value.
const attrRe = (tags: string, name: string) =>
  new RegExp(`(<(?:${tags})\\b[^>]*?\\s${name}\\s*=\\s*)(["'])([^"']+)\\2`, 'gi');
// <source> covers <video><source src="film.webm"> as well as <picture>.
const SRC_RE = attrRe('img|source|video', 'src');
const SRCSET_RE = attrRe('img|source', 'srcset');
const POSTER_RE = attrRe('video', 'poster');
const LINK_RE = /<link\b[^>]*>/gi;
// Any attribute with a value inside a tag. Groups: 1 = name, 3 = quoted value, 4 = bare value.
const ATTR_RE = /\s([a-z][a-z0-9-]*)\s*=\s*(?:(["'])([^"']*)\2|([^\s"'=<>`]+))/gi;
const ICON_RELS = new Set(['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed']);
const STYLE_RE = /(<style\b[^>]*>)([\s\S]*?)<\/style\s*>/gi;
// CSS url(): quoted ("…" / '…') or bare. Groups: 1 = "…" value, 2 = '…' value, 3 = bare value.
const CSS_URL_RE = /\burl\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'()]+))\s*\)/gi;

/** True for an image or video file type a page can carry. */
export const isMediaFile = (path: string) => MEDIA_EXTS.has(extname(path).toLowerCase());

/** True for a file the CLI uploads as a video (.mp4, .webm). */
export const isVideoFile = (path: string) => VIDEO_EXTS.has(extname(path).toLowerCase());

export type LocalImage = { ref: string; path: string };

/** Where one image reference sits in the HTML: the text in [start, end) is `ref`'s slot. */
type Slot = { start: number; end: number; ref: string };

/**
 * Every place the HTML can point at a media file: `<img|source|video src>`,
 * `<video poster>`, each URL in `<img|source srcset>` (descriptors untouched),
 * `<link rel="icon"|"apple-touch-icon" href>`, and `url(...)` inside `<style>`
 * blocks (not in CSS comments). In document order, never overlapping.
 */
function imageSlots(html: string): Slot[] {
  const slots: Slot[] = [];
  const attrValue = (match: RegExpMatchArray) => ({ start: match.index! + match[1].length + 1, value: match[3] });

  for (const re of [SRC_RE, POSTER_RE]) {
    for (const match of html.matchAll(re)) {
      const { start, value } = attrValue(match);
      slots.push({ start, end: start + value.length, ref: value.trim() });
    }
  }
  for (const match of html.matchAll(SRCSET_RE)) {
    const { start, value } = attrValue(match);
    for (const url of srcsetUrls(value)) slots.push({ start: start + url.offset, end: start + url.offset + url.ref.length, ref: url.ref });
  }
  for (const match of html.matchAll(LINK_RE)) {
    const tag = match[0];
    let rel: string | null = null;
    let href: { offset: number; value: string } | null = null;
    for (const attr of tag.matchAll(ATTR_RE)) {
      const name = attr[1].toLowerCase();
      const value = attr[3] ?? attr[4];
      const end = attr.index! + attr[0].length - (attr[3] === undefined ? 0 : 1);
      if (name === 'rel') rel = value;
      if (name === 'href') href = { offset: end - value.length, value };
    }
    if (!rel || !href || !rel.toLowerCase().split(/\s+/).some((token) => ICON_RELS.has(token))) continue;
    const start = match.index! + href.offset;
    slots.push({ start, end: start + href.value.length, ref: href.value.trim() });
  }
  for (const match of html.matchAll(STYLE_RE)) {
    const cssStart = match.index! + match[1].length;
    // Blank out comments (same length) so url() inside them is ignored.
    const css = match[2].replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
    for (const url of css.matchAll(CSS_URL_RE)) {
      const value = url[1] ?? url[2] ?? url[3];
      const quoted = url[1] !== undefined || url[2] !== undefined;
      const paren = url[0].indexOf('(') + 1;
      const open = paren + url[0].slice(paren).search(/\S/);
      const start = cssStart + url.index! + open + (quoted ? 1 : 0);
      slots.push({ start, end: start + value.length, ref: value.trim() });
    }
  }

  slots.sort((a, b) => a.start - b.start);
  const ordered: Slot[] = [];
  for (const slot of slots) {
    if (slot.ref && (ordered.length === 0 || slot.start >= ordered[ordered.length - 1].end)) ordered.push(slot);
  }
  return ordered;
}

/**
 * The URLs of a srcset value with their offsets, following the HTML parsing
 * rules: candidates are separated by commas, a URL runs to the next whitespace
 * (trailing commas end the candidate), descriptors follow it.
 */
function srcsetUrls(value: string): { offset: number; ref: string }[] {
  const urls: { offset: number; ref: string }[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (/\s/.test(value[i]) || value[i] === ',')) i++;
    if (i >= value.length) break;
    const start = i;
    while (i < value.length && !/\s/.test(value[i])) i++;
    const raw = value.slice(start, i);
    const ref = raw.replace(/,+$/, '');
    if (ref) urls.push({ offset: start, ref });
    if (ref.length !== raw.length) continue; // "a.png," has no descriptors
    let depth = 0;
    for (; i < value.length; i++) {
      const c = value[i];
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (c === ',' && depth === 0) {
        i++;
        break;
      }
    }
  }
  return urls;
}

function inside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return !!rel && !rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel);
}

/**
 * The local media files a page uses (`<img src="chart.png">`, srcset entries,
 * icon links, `url(...)` in `<style>`, and videos: `<video src>`, `<source src>`
 * inside `<video>`, `<video poster>`), relative to the HTML file and inside
 * its folder, checked on real paths so a symlink can't point elsewhere. URLs,
 * data: URIs, absolute paths and `../` references are skipped, so publishing
 * someone else's HTML can never upload a file from elsewhere on this machine.
 * Each distinct reference once, in document order.
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
  for (const { ref } of imageSlots(html)) {
    if (seen.has(ref) || /^(?:[a-z][a-z0-9+.-]*:|\/|\\|#)/i.test(ref)) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(ref.split(/[?#]/)[0]);
    } catch {
      continue;
    }
    if (!MEDIA_EXTS.has(extname(decoded).toLowerCase())) continue;
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

/**
 * True when the HTML names a relative image or video file (not a URL, not
 * root-relative), whether or not it exists: for inline HTML that has no folder
 * to upload such files from.
 */
export function referencesLocalMedia(html: string): boolean {
  return imageSlots(html).some(
    ({ ref }) => !/^(?:[a-z][a-z0-9+.-]*:|\/|\\|#)/i.test(ref) && isMediaFile(ref.split(/[?#]/)[0]),
  );
}

/** Point every image reference that used a local file at its hosted URL; nothing else changes. */
export function rewriteImageRefs(html: string, urls: Map<string, string>): string {
  let out = '';
  let last = 0;
  for (const slot of imageSlots(html)) {
    const url = urls.get(slot.ref);
    if (!url) continue;
    out += html.slice(last, slot.start) + url;
    last = slot.end;
  }
  return out + html.slice(last);
}
