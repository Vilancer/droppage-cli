import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { findLocalImages, rewriteImageRefs } from '../lib/html-images.js';
import { ImageRequestError, pruneImages, uploadImage, type UploadedImage } from './images.js';

/**
 * Upload the local images a page's HTML uses (`<img src="chart.png">`) to that
 * page and return the HTML with those links pointing at the hosted copies. The
 * images belong to the page: they go when it is deleted or expires.
 */
export async function attachLocalImages(
  file: string,
  slug: string,
  { html, update = false }: { html?: Buffer; update?: boolean } = {},
): Promise<{ html: Buffer; uploaded: UploadedImage[] }> {
  const source = html ?? (await readFile(file));
  const text = source.toString('utf8');
  const local = findLocalImages(text, file);
  if (local.length === 0) return { html: source, uploaded: [] };
  const urls = new Map<string, string>();
  const uploaded: UploadedImage[] = [];
  for (const image of local) {
    const result = await uploadImage(image.path, slug, { update });
    urls.set(image.ref, result.url);
    uploaded.push(result);
    console.error(`droppage: image ${basename(image.path)} → ${result.url}`);
  }
  return { html: Buffer.from(rewriteImageRefs(text, urls), 'utf8'), uploaded };
}

/** True when the HTML uses any local image file. */
export async function hasLocalImages(file: string): Promise<boolean> {
  return findLocalImages((await readFile(file)).toString('utf8'), file).length > 0;
}

/**
 * After an update: the server deletes the page's images its new HTML no longer
 * references (it reads the stored HTML itself, so every image is considered and
 * absolute or root-relative /i/ links both count as used). `html` is the HTML
 * just stored; the server prunes only once it reads back exactly that. If it
 * can't yet (409), nothing is deleted and the update still succeeds.
 */
export async function pruneUnusedImages(slug: string, html?: Buffer): Promise<number> {
  try {
    return await pruneImages(slug, html);
  } catch (err) {
    if (err instanceof ImageRequestError && err.status === 409) {
      console.error(`droppage: warning: unused images were kept (${err.message}); the next update removes them`);
      return 0;
    }
    throw err;
  }
}
