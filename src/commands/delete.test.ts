import { Command } from 'commander';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const deletePageMock = vi.fn();
const requireAuthMock = vi.fn();
const confirmMock = vi.fn();

class AuthRequiredError extends Error {
  constructor() {
    super('auth required');
    this.name = 'AuthRequiredError';
  }
}

vi.mock('../services/pages.js', () => ({
  deletePage: (...args: unknown[]) => deletePageMock(...args),
}));

vi.mock('../services/auth.js', () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  AuthRequiredError,
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
}));

async function run(...args: string[]): Promise<void> {
  const { registerDelete } = await import('./delete.js');
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} });
  registerDelete(program);
  await program.parseAsync(['node', 'droppage', 'delete', ...args]);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  deletePageMock.mockReset();
  requireAuthMock.mockReset();
  confirmMock.mockReset();
  requireAuthMock.mockResolvedValue({ id: 'user-1' });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('prompts for confirmation by default before deleting', async () => {
  confirmMock.mockResolvedValue(true);
  deletePageMock.mockResolvedValue({ ok: true, blobWasAbsent: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc123');

  expect(confirmMock).toHaveBeenCalledTimes(1);
  expect(deletePageMock).toHaveBeenCalledWith('abc123', { id: 'user-1' });
});

test('--yes skips the confirmation prompt entirely', async () => {
  deletePageMock.mockResolvedValue({ ok: true, blobWasAbsent: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc123', '--yes');

  expect(confirmMock).not.toHaveBeenCalled();
  expect(deletePageMock).toHaveBeenCalledWith('abc123', { id: 'user-1' });
});

test('declining the confirmation prompt exits 0 without deleting', async () => {
  confirmMock.mockResolvedValue(false);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc123');

  expect(deletePageMock).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(/aborted/i);
});

test('a not-found/not-owned result sets a non-zero exit code', async () => {
  confirmMock.mockResolvedValue(true);
  deletePageMock.mockResolvedValue({
    ok: false,
    partial: false,
    message: 'page not found or already deleted',
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('abc123');

  expect(process.exitCode).toBe(1);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(
    /page not found or already deleted/i,
  );
});
