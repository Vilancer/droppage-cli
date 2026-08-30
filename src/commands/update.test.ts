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

vi.mock('../services/pages.js', () => ({
  updatePageHtml: (...args: unknown[]) => updatePageHtmlMock(...args),
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

  expect(updatePageHtmlMock).toHaveBeenCalledWith({
    slug: 'abc123',
    file: 'report.html',
    user,
  });
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
});
