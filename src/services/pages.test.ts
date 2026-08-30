import type { User } from '@supabase/supabase-js';
import { beforeEach, expect, test, vi } from 'vitest';

const TEST_USER = { id: 'user-123', email: 'pub@example.com' } as User;

const maybeSingle = vi.fn();
const order = vi.fn();
// selectChain supports both the two-.eq()-then-.maybeSingle() shape (update/delete
// row lookup) and the one-.eq()-then-.order() shape (listPages) via one flexible
// chain object that every method returns itself from.
const selectChain: Record<string, unknown> = {};
const eqFirst = vi.fn(() => selectChain);
const eqSecond = eqFirst;
selectChain.eq = eqFirst;
selectChain.maybeSingle = maybeSingle;
selectChain.order = order;
const select = vi.fn(() => selectChain);

const deleteSelect = vi.fn();
const deleteChain: Record<string, unknown> = {};
const deleteEqFirst = vi.fn(() => deleteChain);
const deleteEqSecond = deleteEqFirst;
deleteChain.eq = deleteEqFirst;
deleteChain.select = deleteSelect;
const deleteFn = vi.fn(() => deleteChain);

const updateObject = vi.fn();
const removeObject = vi.fn();
const storageFrom = vi.fn(() => ({ update: updateObject, remove: removeObject }));
const from = vi.fn(() => ({ select, delete: deleteFn }));
const readFileMock = vi.fn();
const rpc = vi.fn();
const createClientMock = vi.fn(() => ({
  from,
  storage: { from: storageFrom },
  rpc,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('../lib/config.js', () => ({
  createConfStorage: vi.fn(() => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })),
}));

vi.mock('../lib/env.js', () => ({
  resolveSupabaseEnv: vi.fn(() => ({
    url: 'http://127.0.0.1:54321',
    anonKey: 'anon-test-key',
  })),
}));

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  maybeSingle.mockReset();
  updateObject.mockReset();
  readFileMock.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  order.mockReset();
  removeObject.mockReset();
  deleteSelect.mockReset();
});

test('update validates HTML before any Supabase call', async () => {
  readFileMock.mockResolvedValue(Buffer.from('not html'));
  const { updatePageHtml } = await import('./pages.js');

  await expect(
    updatePageHtml({ slug: 'abc123', file: 'bad.html', user: TEST_USER }),
  ).rejects.toThrow(/does not look like html/i);

  expect(from).not.toHaveBeenCalled();
  expect(updateObject).not.toHaveBeenCalled();
});

test('update resolves row with slug and owner filters, then replaces authoritative storage_path', async () => {
  readFileMock.mockResolvedValue(
    Buffer.from('<!doctype html><html><body>new</body></html>'),
  );
  maybeSingle.mockResolvedValue({
    data: { slug: 'abc123', storage_path: 'user-123/abc123.html' },
    error: null,
  });
  updateObject.mockResolvedValue({ data: { path: 'user-123/abc123.html' }, error: null });
  const { updatePageHtml } = await import('./pages.js');

  const result = await updatePageHtml({
    slug: 'abc123',
    file: 'report.html',
    user: TEST_USER,
  });

  expect(from).toHaveBeenCalledWith('pages');
  expect(select).toHaveBeenCalledWith('slug, storage_path');
  expect(eqFirst).toHaveBeenCalledWith('slug', 'abc123');
  expect(eqSecond).toHaveBeenCalledWith('owner_id', 'user-123');
  expect(maybeSingle).toHaveBeenCalled();
  expect(storageFrom).toHaveBeenCalledWith('pages');
  expect(updateObject).toHaveBeenCalledWith(
    'user-123/abc123.html',
    expect.any(Buffer),
    { contentType: 'text/html; charset=utf-8' },
  );
  expect(result).toEqual({
    slug: 'abc123',
    storagePath: 'user-123/abc123.html',
    url: 'https://droppage.dev/p/abc123',
  });
});

test('missing or unowned slug causes no storage call', async () => {
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><html></html>'));
  maybeSingle.mockResolvedValue({ data: null, error: null });
  const { updatePageHtml } = await import('./pages.js');

  await expect(
    updatePageHtml({ slug: 'missing', file: 'report.html', user: TEST_USER }),
  ).rejects.toThrow(/not found or not owned/i);

  expect(updateObject).not.toHaveBeenCalled();
});

test('select error propagates without storage call', async () => {
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><html></html>'));
  maybeSingle.mockResolvedValue({
    data: null,
    error: { message: 'permission denied' },
  });
  const { updatePageHtml } = await import('./pages.js');

  await expect(
    updatePageHtml({ slug: 'abc123', file: 'report.html', user: TEST_USER }),
  ).rejects.toMatchObject({ message: 'permission denied' });
  expect(updateObject).not.toHaveBeenCalled();
});

test('rejects storage path outside owner folder', async () => {
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><html></html>'));
  maybeSingle.mockResolvedValue({
    data: { slug: 'abc123', storage_path: 'other-user/abc123.html' },
    error: null,
  });
  const { updatePageHtml } = await import('./pages.js');

  await expect(
    updatePageHtml({ slug: 'abc123', file: 'report.html', user: TEST_USER }),
  ).rejects.toThrow(/not owner-scoped/i);
  expect(updateObject).not.toHaveBeenCalled();
});

test('storage replacement failure reports previous content may still serve', async () => {
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><html></html>'));
  maybeSingle.mockResolvedValue({
    data: { slug: 'abc123', storage_path: 'user-123/abc123.html' },
    error: null,
  });
  updateObject.mockResolvedValue({ data: null, error: { message: 'network down' } });
  const { updatePageHtml } = await import('./pages.js');

  await expect(
    updatePageHtml({ slug: 'abc123', file: 'report.html', user: TEST_USER }),
  ).rejects.toThrow(/previous content/i);
});

// --- listPages ---------------------------------------------------------

test('listPages scopes the query to the authenticated owner and orders newest-first', async () => {
  order.mockResolvedValue({
    data: [
      {
        slug: 'newer',
        access_mode: 'public',
        allowed_emails: null,
        view_count: 1,
        created_at: '2026-08-02T00:00:00.000Z',
        last_viewed_at: null,
      },
      {
        slug: 'older',
        access_mode: 'public',
        allowed_emails: null,
        view_count: 0,
        created_at: '2026-08-01T00:00:00.000Z',
        last_viewed_at: null,
      },
    ],
    error: null,
  });
  const { listPages } = await import('./pages.js');

  const rows = await listPages(TEST_USER);

  expect(from).toHaveBeenCalledWith('pages');
  expect(eqFirst).toHaveBeenCalledWith('owner_id', 'user-123');
  expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  expect(rows.map((r) => r.slug)).toEqual(['newer', 'older']);
});

test('listPages returns an empty array (not null) with no rows', async () => {
  order.mockResolvedValue({ data: null, error: null });
  const { listPages } = await import('./pages.js');
  await expect(listPages(TEST_USER)).resolves.toEqual([]);
});

test('listPages propagates a query error', async () => {
  order.mockResolvedValue({ data: null, error: { message: 'db down' } });
  const { listPages } = await import('./pages.js');
  await expect(listPages(TEST_USER)).rejects.toMatchObject({
    message: 'db down',
  });
});

// --- deletePage ----------------------------------------------------------

test('unknown and non-owned slugs both produce the identical generic not-found message', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  const { deletePage } = await import('./pages.js');

  const unknown = await deletePage('does-not-exist', TEST_USER);
  const notOwned = await deletePage('someone-elses-slug', TEST_USER);

  expect(unknown).toEqual({
    ok: false,
    partial: false,
    message: 'page not found or already deleted',
  });
  expect(notOwned).toEqual(unknown);
  expect(removeObject).not.toHaveBeenCalled();
  expect(deleteFn).not.toHaveBeenCalled();
});

test('deletePage removes the storage blob before deleting the metadata row', async () => {
  maybeSingle.mockResolvedValue({
    data: { slug: 'abc123', storage_path: 'user-123/abc123.html' },
    error: null,
  });
  const callOrder: string[] = [];
  removeObject.mockImplementation(async () => {
    callOrder.push('storage.remove');
    return { data: [{ name: 'abc123.html' }], error: null };
  });
  deleteSelect.mockImplementation(async () => {
    callOrder.push('row.delete');
    return { data: [{ slug: 'abc123' }], error: null };
  });
  const { deletePage } = await import('./pages.js');

  const result = await deletePage('abc123', TEST_USER);

  expect(callOrder).toEqual(['storage.remove', 'row.delete']);
  expect(removeObject).toHaveBeenCalledWith(['user-123/abc123.html']);
  expect(result).toEqual({ ok: true, blobWasAbsent: false });
});

test('blob-remove error leaves the row untouched and reports the link still works', async () => {
  maybeSingle.mockResolvedValue({
    data: { slug: 'abc123', storage_path: 'user-123/abc123.html' },
    error: null,
  });
  removeObject.mockResolvedValue({
    data: null,
    error: { message: 'network error' },
  });
  const { deletePage } = await import('./pages.js');

  const result = await deletePage('abc123', TEST_USER);

  expect(deleteFn).not.toHaveBeenCalled();
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.partial).toBe(false);
    expect(result.message).toMatch(/link still works/i);
  }
});

test('row-delete failure after a successful blob removal is a loud, non-silent partial failure naming the slug', async () => {
  maybeSingle.mockResolvedValue({
    data: { slug: 'abc123', storage_path: 'user-123/abc123.html' },
    error: null,
  });
  removeObject.mockResolvedValue({
    data: [{ name: 'abc123.html' }],
    error: null,
  });
  deleteSelect.mockResolvedValue({
    data: [],
    error: { message: 'row locked' },
  });
  const { deletePage } = await import('./pages.js');

  const result = await deletePage('abc123', TEST_USER);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.partial).toBe(true);
    expect(result.message).toContain('abc123');
  }
});

test('storage.remove returning an empty data array (already-absent blob) is a warning, not a failure', async () => {
  maybeSingle.mockResolvedValue({
    data: { slug: 'abc123', storage_path: 'user-123/abc123.html' },
    error: null,
  });
  removeObject.mockResolvedValue({ data: [], error: null });
  deleteSelect.mockResolvedValue({ data: [{ slug: 'abc123' }], error: null });
  const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { deletePage } = await import('./pages.js');

  const result = await deletePage('abc123', TEST_USER);

  expect(result).toEqual({ ok: true, blobWasAbsent: true });
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('warning'));
  warnSpy.mockRestore();
});
