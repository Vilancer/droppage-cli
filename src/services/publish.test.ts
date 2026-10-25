import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const order: string[] = [];
const uploadMock = vi.fn();
const setPageExpiryMock = vi.fn();
const pruneMock = vi.fn();

vi.mock('node:fs/promises', () => ({ readFile: async () => Buffer.from('<html></html>') }));
vi.mock('./upload.js', () => ({ upload: (...a: unknown[]) => uploadMock(...a) }));
vi.mock('./page-images.js', () => ({
  hasLocalImages: async () => true,
  attachLocalImages: async (_file: string, slug: string) => {
    order.push(`images:${slug}`);
    return { html: Buffer.from('<img src="https://droppage.dev/i/x.png">'), uploaded: [{ id: 'x', url: 'https://droppage.dev/i/x.png' }] };
  },
  pruneUnusedImages: async (...a: unknown[]) => { order.push('prune'); return pruneMock(...a); },
}));
vi.mock('./pages.js', () => ({
  assertUpdateAllowed: async () => { order.push('check'); },
  updatePageHtml: async ({ slug }: { slug: string }) => { order.push('html'); return { url: `https://droppage.dev/p/${slug}` }; },
  setPageExpiry: (...a: unknown[]) => { order.push('expiry'); return setPageExpiryMock(...a); },
}));

const user = { id: 'u1', email: ' Owner@X.com ' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  pruneMock.mockResolvedValue(0);
});
afterEach(() => vi.restoreAllMocks());

test('resolveAccess: email lists are cleaned and validated, private is the owner, password needs a hash', async () => {
  const { resolveAccess } = await import('./publish.js');
  expect(resolveAccess(user, 'public')).toEqual({ accessMode: 'public' });
  expect(resolveAccess(user, 'email', { emails: [' A@x.com', 'a@x.com', '', 'b@y.com'] })).toEqual({
    accessMode: 'email',
    allowedEmails: ['a@x.com', 'b@y.com'],
  });
  expect(() => resolveAccess(user, 'email', { emails: ['  '] })).toThrow('no email addresses given');
  expect(() => resolveAccess(user, 'email', { emails: ['a@x.com', 'bad'] })).toThrow('invalid email address(es): bad');
  expect(resolveAccess(user, 'private')).toEqual({ accessMode: 'private', allowedEmails: ['owner@x.com'] });
  expect(() => resolveAccess({ id: 'u2' } as never, 'private')).toThrow(/private page needs an email/);
  expect(() => resolveAccess(user, 'password')).toThrow(/password/);
  expect(resolveAccess(user, 'password', { passwordHash: '$2a$10$h' })).toEqual({ accessMode: 'password', passwordHash: '$2a$10$h' });
});

test('publishPage uploads the local media for the chosen slug and returns it', async () => {
  uploadMock.mockImplementation(async ({ prepare }: { prepare: (slug: string) => Promise<Buffer> }) => {
    await prepare('Slug000001');
    return 'https://droppage.dev/p/Slug000001';
  });
  const { publishPage } = await import('./publish.js');
  const result = await publishPage({ file: 'r.html', user, access: { accessMode: 'public' } });
  expect(result).toEqual({ url: 'https://droppage.dev/p/Slug000001', media: [{ id: 'x', url: 'https://droppage.dev/i/x.png' }] });
  expect(order).toEqual(['images:Slug000001']);
  expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({ accessMode: 'public', file: 'r.html' }));
});

test('updatePage checks first, then images, HTML, prune and expiry, reporting each on stderr', async () => {
  pruneMock.mockResolvedValue(2);
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { updatePage } = await import('./publish.js');
  const result = await updatePage({ slug: 'abc', file: 'r.html', user, expiresAt: null });
  expect(order).toEqual(['check', 'images:abc', 'html', 'prune', 'expiry']);
  expect(setPageExpiryMock).toHaveBeenCalledWith('abc', null);
  expect(result).toMatchObject({ url: 'https://droppage.dev/p/abc', removed: 2 });
  expect(err.mock.calls.map((c) => c[0])).toEqual([
    'droppage: removed 2 image or video file(s) the page no longer uses',
    'droppage: never expires',
  ]);
});

test('updatePage leaves the expiry alone when none is given', async () => {
  const { updatePage } = await import('./publish.js');
  await updatePage({ slug: 'abc', file: 'r.html', user });
  expect(setPageExpiryMock).not.toHaveBeenCalled();
});
