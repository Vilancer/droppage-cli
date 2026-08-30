import { Command } from 'commander';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const listPagesMock = vi.fn();
const requireAuthMock = vi.fn();
const getSessionMock = vi.fn();
const fetchMock = vi.fn();

class AuthRequiredError extends Error {
  constructor() {
    super('auth required');
    this.name = 'AuthRequiredError';
  }
}

vi.mock('../services/pages.js', () => ({
  listPages: (...args: unknown[]) => listPagesMock(...args),
}));

vi.mock('../services/auth.js', () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  AuthRequiredError,
}));

vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: () => ({
    auth: { getSession: getSessionMock },
  }),
}));

async function run(...args: string[]): Promise<void> {
  const { registerList } = await import('./list.js');
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} });
  registerList(program);
  await program.parseAsync(['node', 'droppage', 'list', ...args]);
}

const PAGE = {
  slug: 'abc123',
  access_mode: 'public' as const,
  allowed_emails: null,
  view_count: 5,
  created_at: '2026-08-01T00:00:00.000Z',
  last_viewed_at: null,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  listPagesMock.mockReset();
  requireAuthMock.mockReset();
  getSessionMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('--json emits a valid array with url, allowed_emails, and ISO dates', async () => {
  requireAuthMock.mockResolvedValue({ id: 'user-1' });
  listPagesMock.mockResolvedValue([PAGE]);
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('--json');

  expect(outSpy).toHaveBeenCalledTimes(1);
  const written = outSpy.mock.calls[0][0] as string;
  const parsed = JSON.parse(written);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed[0]).toMatchObject({
    slug: 'abc123',
    url: 'https://droppage.dev/p/abc123',
    allowed_emails: [],
    created_at: '2026-08-01T00:00:00.000Z',
  });
});

test('--json with no pages prints [] on stdout, and the empty-state note goes to stderr only', async () => {
  requireAuthMock.mockResolvedValue({ id: 'user-1' });
  listPagesMock.mockResolvedValue([]);
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('--json');

  const written = outSpy.mock.calls.map((c) => c[0]).join('');
  // stdout must remain valid, parseable JSON — no note text mixed in.
  expect(() => JSON.parse(written)).not.toThrow();
  expect(JSON.parse(written)).toEqual([]);
  expect(written).not.toMatch(/no pages yet/i);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(/no pages yet/i);
});

test('--preview mint failure warns on stderr but still renders the table', async () => {
  requireAuthMock.mockResolvedValue({ id: 'user-1' });
  listPagesMock.mockResolvedValue([PAGE]);
  getSessionMock.mockResolvedValue({
    data: { session: { access_token: 'jwt-token' } },
  });
  fetchMock.mockResolvedValue({ ok: false });
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('--preview');

  expect(errSpy.mock.calls.flat().join('\n')).toMatch(
    /could not fetch preview urls/i,
  );
  // The table must still render (not swallowed by the failed preview fetch).
  expect(outSpy).toHaveBeenCalledTimes(1);
  const table = outSpy.mock.calls[0][0] as string;
  expect(table).toContain('abc123');
  expect(table).toContain('PREVIEW');
});
