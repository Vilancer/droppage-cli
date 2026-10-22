import { Command } from 'commander';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const updatePageHtmlMock = vi.fn();
const requireAuthMock = vi.fn();

class AuthRequiredError extends Error {
  constructor() {
    super('auth required');
    this.name = 'AuthRequiredError';
  }
}

const assertUpdateAllowedMock = vi.fn(async () => undefined);
const setPageExpiryMock = vi.fn(async () => undefined);
const attachLocalImagesMock = vi.fn(async () => ({ html: Buffer.from('<html></html>'), uploaded: [] }));
const pruneUnusedImagesMock = vi.fn(async () => 0);

vi.mock('../services/pages.js', () => ({
  updatePageHtml: (...args: unknown[]) => updatePageHtmlMock(...args),
  assertUpdateAllowed: (...args: unknown[]) => assertUpdateAllowedMock(...(args as [])),
  setPageExpiry: (...args: unknown[]) => setPageExpiryMock(...(args as [])),
}));

const validateMock = vi.fn(() => ({ ok: true, warnings: [] }));
vi.mock('node:fs/promises', () => ({ readFile: async () => Buffer.from('<html></html>') }));
vi.mock('../lib/validate-html.js', () => ({ validateHtmlUpload: (...a: unknown[]) => validateMock(...(a as [])) }));

vi.mock('../services/page-images.js', () => ({
  attachLocalImages: (...args: unknown[]) => attachLocalImagesMock(...(args as [])),
  pruneUnusedImages: (...args: unknown[]) => pruneUnusedImagesMock(...(args as [])),
}));

vi.mock('../services/auth.js', () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  AuthRequiredError,
}));

async function run(...args: string[]): Promise<void> {
  const { registerUpdate } = await import('./update.js');
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} });
  registerUpdate(program);
  await program.parseAsync(['node', 'droppage', 'update', ...args]);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  updatePageHtmlMock.mockReset();
  requireAuthMock.mockReset();
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('missing slug or file is rejected by Commander before any service call', async () => {
  await expect(run('abc123')).rejects.toThrow();
  expect(requireAuthMock).not.toHaveBeenCalled();
  expect(updatePageHtmlMock).not.toHaveBeenCalled();
});

test('auth failure returns without calling update service', async () => {
  requireAuthMock.mockRejectedValue(new AuthRequiredError());
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc123', 'report.html');

  expect(updatePageHtmlMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
});

test('success writes only the URL to stdout and progress to stderr', async () => {
  const user = { id: 'user-1' };
  const url = 'https://droppage.dev/p/abc123';
  requireAuthMock.mockResolvedValue(user);
  updatePageHtmlMock.mockResolvedValue({
    slug: 'abc123',
    url,
    storagePath: 'user-1/abc123.html',
  });
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc123', 'report.html');

  expect(updatePageHtmlMock).toHaveBeenCalledWith(expect.objectContaining({
    slug: 'abc123',
    file: 'report.html',
    user,
  }));
  expect(outSpy).toHaveBeenCalledTimes(1);
  expect(outSpy).toHaveBeenCalledWith(`${url}\n`);
  const errText = errSpy.mock.calls.flat().join('\n');
  expect(errText).toMatch(/updating abc123 from report\.html/i);
  expect(errText).toMatch(/updated abc123/i);
  expect(errText).not.toContain(url);
  expect(process.exitCode).toBeUndefined();
});

test('failure writes nothing to stdout and sets exit code', async () => {
  requireAuthMock.mockResolvedValue({ id: 'user-1' });
  updatePageHtmlMock.mockRejectedValue(new Error('page not found or not owned'));
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc123', 'report.html');

  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(
    /update failed: page not found or not owned/i,
  );
  expect(errSpy.mock.calls.flat().join('\n')).not.toContain('droppage quota');
});

test.each([
  'page quota reached for this account',
  'password pages require Starter',
  'email pages require Builder',
])('quota/plan failure adds actionable quota guidance: %s', async (message) => {
  requireAuthMock.mockResolvedValue({ id: 'user-1' });
  updatePageHtmlMock.mockRejectedValue(new Error(message));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc123', 'report.html');

  expect(errSpy.mock.calls.flat().join('\n')).toContain(
    'run `droppage quota` to see your limits',
  );
});

test('update checks the plan before uploading any image, then attaches images and prunes unused ones', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  updatePageHtmlMock.mockResolvedValue({ slug: 'abc', url: 'https://droppage.dev/p/abc', storagePath: 'u1/abc.html' });
  const order: string[] = [];
  assertUpdateAllowedMock.mockImplementationOnce(async () => { order.push('check'); });
  attachLocalImagesMock.mockImplementationOnce(async () => { order.push('images'); return { html: Buffer.from('<img src="x">'), uploaded: [] }; });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc', 'report.html', '--expires', '7d');

  expect(order).toEqual(['check', 'images']);
  expect(updatePageHtmlMock).toHaveBeenCalledWith(expect.objectContaining({ slug: 'abc', html: Buffer.from('<img src="x">') }));
  expect(attachLocalImagesMock).toHaveBeenCalledWith('report.html', 'abc', { update: true });
  expect(pruneUnusedImagesMock).toHaveBeenCalledWith('abc', Buffer.from('<img src="x">'));
  expect(setPageExpiryMock).toHaveBeenCalledWith('abc', expect.any(Date));
});

test('a refused update uploads no images', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  assertUpdateAllowedMock.mockRejectedValueOnce(new Error('updates require Starter or Builder'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await run('abc', 'report.html');
  expect(attachLocalImagesMock).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  process.exitCode = 0;
});

test('a file that fails validation uploads no images', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  validateMock.mockImplementationOnce(() => { throw new Error('droppage only uploads .html or .htm files'); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await run('abc', 'report.txt');
  expect(attachLocalImagesMock).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  process.exitCode = 0;
});
