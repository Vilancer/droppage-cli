import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { resolveShareBaseUrl } from '../lib/share-url.js';
import { createSupabaseClient } from '../lib/supabase.js';

/** Largest image the server accepts. Checked here only for a fast, clear error. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type UploadedImage = {
  id: string;
  url: string;
  bytes: number;
  content_type: string;
  existing: boolean;
};

export type ImageRow = {
  id: string;
  url: string;
  ext: string;
  content_type: string;
  bytes: number;
  name: string | null;
  created_at: string;
  page: string | null;
};

export type ImageList = {
  images: ImageRow[];
  /** Present when listing one page: its image use and its per-page budget. */
  page?: { slug: string; used_bytes: number; limit_bytes: number | null };
};

/** Above this, PNG/JPEG/GIF images get a hint to use WebP or AVIF instead. */
const HEAVY_IMAGE_BYTES = 300 * 1024;

export class ImageRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ImageRequestError';
  }
}

async function accessToken(): Promise<string> {
  const { data } = await createSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ImageRequestError('not signed in; run `droppage login`', 401);
  return token;
}

async function call(path: string, init: RequestInit): Promise<unknown> {
  const base = resolveShareBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, init);
  } catch (err) {
    throw new ImageRequestError(`could not reach ${base}: ${err instanceof Error ? err.message : String(err)}`, 0);
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A proxy can return HTML; keep the HTTP status below.
  }
  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error ?? `request failed (HTTP ${response.status})`;
    throw new ImageRequestError(message, response.status);
  }
  return body;
}

/**
 * Upload one image file to a page (an existing page of yours, or the slug about
 * to be published). The server decides its type from the bytes; the image goes
 * when the page is deleted or expires.
 */
export async function uploadImage(file: string, slug: string, { update = false } = {}): Promise<UploadedImage> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new ImageRequestError(`file not found: ${file}`, 0);
  if (info.size === 0) throw new ImageRequestError(`file is empty: ${file}`, 0);
  if (info.size > MAX_IMAGE_BYTES) {
    throw new ImageRequestError(`image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB (${info.size} bytes): ${file}`, 413);
  }
  const bytes = await readFile(file);
  const body = await call('/api/images', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/octet-stream',
      'X-Droppage-Filename': encodeURIComponent(basename(file)),
      'X-Droppage-Page': slug,
      ...(update ? { 'X-Droppage-Update': '1' } : {}),
    },
    body: bytes,
  });
  if (info.size > HEAVY_IMAGE_BYTES && /\.(png|jpe?g|gif)$/i.test(file)) {
    console.error(`droppage: tip: ${basename(file)} is ${Math.round(info.size / 1024)} KB; WebP or AVIF is usually several times smaller (SVG for charts).`);
  }
  const image = body as UploadedImage | null;
  if (!image || typeof image.url !== 'string' || typeof image.id !== 'string') {
    throw new ImageRequestError('unexpected response from the image API', 0);
  }
  return image;
}

export async function listImages(slug?: string): Promise<ImageList> {
  const query = slug ? `?page=${encodeURIComponent(slug)}` : '';
  const body = await call(`/api/images${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  const list = body as ImageList | null;
  if (!list || !Array.isArray(list.images)) throw new ImageRequestError('unexpected response from the image API', 0);
  return list;
}

/** Accepts an id, `id.ext`, or a full image URL. */
export function imageIdFrom(value: string): string | null {
  const match = /(?:^|\/i\/)([A-Za-z0-9]{12})(?:\.[a-z]+)?$/.exec(value.trim());
  return match ? match[1] : null;
}

export async function deleteImage(idOrUrl: string): Promise<string> {
  const id = imageIdFrom(idOrUrl);
  if (!id) throw new ImageRequestError(`not an image id or URL: ${idOrUrl}`, 0);
  await call(`/api/images/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  return id;
}

/** Ask the server to delete a page's images its stored HTML no longer references. */
export async function pruneImages(slug: string): Promise<number> {
  const body = await call(`/api/pages/${encodeURIComponent(slug)}/images/prune`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  return Number((body as { removed?: number } | null)?.removed ?? 0);
}
