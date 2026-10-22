import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const getSession = vi.fn();
vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: () => ({ auth: { getSession } }),
}));

let fetchMock: ReturnType<typeof vi.fn>;
let dir: string;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.DROPPAGE_SHARE_BASE_URL = 'https://serve.test';
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  dir = await mkdtemp(join(tmpdir(), 'droppage-images-'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DROPPAGE_SHARE_BASE_URL;
});

test('uploads the raw file bytes with the bearer session and file name', async () => {
  const file = join(dir, 'q3 chart.png');
  await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fetchMock.mockResolvedValue(Response.json(
    { id: 'AbCdEfGhIjKl', url: 'https://serve.test/i/AbCdEfGhIjKl.png', bytes: 4, content_type: 'image/png', existing: false },
    { status: 201 },
  ));
  const { uploadImage } = await import('./images.js');

  await expect(uploadImage(file, 'Q3report01')).resolves.toMatchObject({ url: 'https://serve.test/i/AbCdEfGhIjKl.png' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://serve.test/api/images');
  expect(init.method).toBe('POST');
  expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-123', 'X-Droppage-Filename': 'q3%20chart.png', 'X-Droppage-Page': 'Q3report01' });
});

test('refuses files over 4 MB before the network', async () => {
  const file = join(dir, 'big.png');
  await writeFile(file, Buffer.alloc(4 * 1024 * 1024 + 1));
  const { uploadImage } = await import('./images.js');
  await expect(uploadImage(file, 'Q3report01')).rejects.toThrow(/larger than 4 MB/);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('surfaces the server error message', async () => {
  const file = join(dir, 'a.png');
  await writeFile(file, Buffer.from([1]));
  fetchMock.mockResolvedValue(Response.json({ error: 'image storage quota reached (1 of 2 bytes used)' }, { status: 403 }));
  const { uploadImage } = await import('./images.js');
  await expect(uploadImage(file, 'Q3report01')).rejects.toMatchObject({ status: 403, message: expect.stringContaining('quota reached') });
});

test('delete accepts an id, id.ext or a full URL', async () => {
  const { imageIdFrom } = await import('./images.js');
  expect(imageIdFrom('AbCdEfGhIjKl')).toBe('AbCdEfGhIjKl');
  expect(imageIdFrom('AbCdEfGhIjKl.webp')).toBe('AbCdEfGhIjKl');
  expect(imageIdFrom('https://droppage.dev/i/AbCdEfGhIjKl.png')).toBe('AbCdEfGhIjKl');
  expect(imageIdFrom('https://droppage.dev/p/abc')).toBeNull();
  expect(imageIdFrom('../etc')).toBeNull();
});

test('prune sends the SHA-256 of the HTML just stored, so a stale server read deletes nothing', async () => {
  fetchMock.mockResolvedValue(Response.json({ removed: 2, kept: 1 }));
  const { pruneImages } = await import('./images.js');
  await expect(pruneImages('Q3report01', Buffer.from('<img src="/i/AAAAAAAAAAAA.png">'))).resolves.toBe(2);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://serve.test/api/pages/Q3report01/images/prune');
  expect(JSON.parse(init.body)).toEqual({
    html_sha256: '' + (await import('node:crypto')).createHash('sha256').update('<img src="/i/AAAAAAAAAAAA.png">').digest('hex'),
  });
});

test('a prune the server refuses as not yet consistent (409) keeps the images and does not fail the update', async () => {
  fetchMock.mockResolvedValue(Response.json({ error: 'the stored HTML does not match the update yet; unused images were kept' }, { status: 409 }));
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { pruneUnusedImages } = await import('./page-images.js');
  await expect(pruneUnusedImages('Q3report01', Buffer.from('<p>x</p>'))).resolves.toBe(0);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('unused images were kept'));
  fetchMock.mockResolvedValue(Response.json({ error: 'could not prune images' }, { status: 500 }));
  await expect(pruneUnusedImages('Q3report01', Buffer.from('<p>x</p>'))).rejects.toMatchObject({ status: 500 });
});
