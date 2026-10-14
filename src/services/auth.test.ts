/**
 * Publisher auth service contracts (Plan 05).
 * Expected exports: login, logout, requireAuth, getCurrentUser, AuthRequiredError
 */
import { beforeEach, expect, test, vi } from 'vitest';

const getUser = vi.fn();
const signOut = vi.fn();
const getSession = vi.fn();
const signInWithOtp = vi.fn();
const exchangeCodeForSession = vi.fn();

const inputPrompt = vi.fn();
const openMock = vi.fn();
const pickCallbackPortMock = vi.fn();
const waitForAuthCodeMock = vi.fn();
const resolveSupabaseEnvMock = vi.fn(() => ({
  url: 'https://example.supabase.co',
  anonKey: 'anon-test-key',
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser,
      signOut,
      getSession,
      signInWithOtp,
      exchangeCodeForSession,
    },
  })),
}));

vi.mock('../lib/config.js', () => ({
  getDroppageConfigPath: vi.fn(() => '/tmp/droppage-w0-config.json'),
  createConfStorage: vi.fn(() => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })),
}));

vi.mock('../lib/env.js', () => ({
  resolveSupabaseEnv: (...args: unknown[]) => resolveSupabaseEnvMock(...args),
}));

vi.mock('../lib/callback-server.js', () => ({
  pickCallbackPort: (...args: unknown[]) => pickCallbackPortMock(...args),
  waitForAuthCode: (...args: unknown[]) => waitForAuthCodeMock(...args),
}));

vi.mock('@inquirer/prompts', () => ({
  input: (...args: unknown[]) => inputPrompt(...args),
}));

vi.mock('open', () => ({
  default: (...args: unknown[]) => openMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockReset();
  signOut.mockReset();
  getSession.mockReset();
  signInWithOtp.mockReset();
  exchangeCodeForSession.mockReset();
  inputPrompt.mockReset();
  openMock.mockReset();
  pickCallbackPortMock.mockReset();
  waitForAuthCodeMock.mockReset();
  resolveSupabaseEnvMock.mockReset();
  resolveSupabaseEnvMock.mockReturnValue({
    url: 'https://example.supabase.co',
    anonKey: 'anon-test-key',
  });
  process.exitCode = undefined;
});

test('login short-circuits when getUser returns a user', async () => {
  getUser.mockResolvedValue({
    data: { user: { id: 'u1', email: 'pub@example.com' } },
    error: null,
  });

  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { login } = await import('./auth.js');
  await expect(login()).resolves.toBeUndefined();
  expect(signInWithOtp).not.toHaveBeenCalled();
  expect(logSpy).toHaveBeenCalledWith('Logged in as pub@example.com');
  expect(process.exitCode).toBe(0);
  logSpy.mockRestore();
});

test('login OTP flow never opens loopback emailRedirectTo as magic link', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  inputPrompt.mockResolvedValue('pub@example.com');
  pickCallbackPortMock.mockResolvedValue(19876);
  waitForAuthCodeMock.mockResolvedValue('pkce-code');
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
  exchangeCodeForSession.mockResolvedValue({
    data: { user: { id: 'u1', email: 'pub@example.com' }, session: {} },
    error: null,
  });

  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { login } = await import('./auth.js');
  await expect(login()).resolves.toBeUndefined();

  expect(signInWithOtp).toHaveBeenCalledWith({
    email: 'pub@example.com',
    options: {
      shouldCreateUser: true,
      emailRedirectTo: 'http://127.0.0.1:19876/callback',
    },
  });
  expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');
  expect(logSpy.mock.calls.flat().join('\n')).toMatch(/check your email/i);
  expect(logSpy).toHaveBeenCalledWith('Logged in as pub@example.com');

  for (const call of openMock.mock.calls) {
    const url = String(call[0] ?? '');
    expect(url).not.toMatch(/127\.0\.0\.1:\d+\/callback/);
    expect(url).not.toBe('http://127.0.0.1:19876/callback');
  }

  logSpy.mockRestore();
});

function mockLocalLogin() {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  resolveSupabaseEnvMock.mockReturnValue({
    url: 'http://127.0.0.1:54321',
    anonKey: 'anon-test-key',
  });
  inputPrompt.mockResolvedValue('local@example.com');
  pickCallbackPortMock.mockResolvedValue(19876);
  waitForAuthCodeMock.mockResolvedValue('code');
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
  exchangeCodeForSession.mockResolvedValue({
    data: { user: { id: 'u2', email: 'local@example.com' }, session: {} },
    error: null,
  });
  openMock.mockResolvedValue(undefined);
}

test('login opens Inbucket for local Supabase, not the callback URL', async () => {
  // This runs in CI too, where CI=true would (correctly) suppress the browser.
  vi.stubEnv('CI', '');
  vi.stubEnv('DROPPAGE_NO_BROWSER', '');
  mockLocalLogin();

  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { login } = await import('./auth.js');
  await login();

  expect(openMock).toHaveBeenCalledWith('http://127.0.0.1:54324');
  expect(openMock).not.toHaveBeenCalledWith(
    expect.stringMatching(/\/callback/),
  );
  logSpy.mockRestore();
  vi.unstubAllEnvs();
});

test('DROPPAGE_NO_BROWSER keeps a local login from opening a browser', async () => {
  vi.stubEnv('CI', '');
  vi.stubEnv('DROPPAGE_NO_BROWSER', '1');
  mockLocalLogin();

  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { login } = await import('./auth.js');
  await login();

  expect(openMock).not.toHaveBeenCalled();
  logSpy.mockRestore();
  vi.unstubAllEnvs();
});

test('login does not arm the callback waiter when OTP send fails (CR-01)', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  inputPrompt.mockResolvedValue('pub@example.com');
  pickCallbackPortMock.mockResolvedValue(19876);
  signInWithOtp.mockResolvedValue({
    data: {},
    error: { message: 'rate limit exceeded' },
  });

  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { login } = await import('./auth.js');

  await expect(login()).rejects.toMatchObject({
    message: 'rate limit exceeded',
  });

  // On OTP failure the loopback HTTP server + 300s timeout must never be armed,
  // otherwise they keep the event loop alive ~5 min and orphan a rejection.
  expect(waitForAuthCodeMock).not.toHaveBeenCalled();
  expect(exchangeCodeForSession).not.toHaveBeenCalled();
  expect(errSpy).toHaveBeenCalledWith(
    'Failed to send magic link: rate limit exceeded',
  );
  expect(process.exitCode).toBe(1);
  errSpy.mockRestore();
});

test('logout with empty session exits success path', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  signOut.mockResolvedValue({ error: null });

  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { logout } = await import('./auth.js');
  await expect(logout()).resolves.toBeUndefined();
  expect(signOut).not.toHaveBeenCalled();
  expect(logSpy).toHaveBeenCalledWith('Already logged out');
  expect(process.exitCode).toBe(0);
  logSpy.mockRestore();
});

test('logout with session calls signOut and prints Logged out', async () => {
  getSession.mockResolvedValue({
    data: { session: { access_token: 'tok' } },
    error: null,
  });
  signOut.mockResolvedValue({ error: null });

  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { logout } = await import('./auth.js');
  await expect(logout()).resolves.toBeUndefined();
  expect(signOut).toHaveBeenCalled();
  expect(logSpy).toHaveBeenCalledWith('Logged out');
  expect(process.exitCode).toBe(0);
  logSpy.mockRestore();
});

test('requireAuth throws/fails when no session', async () => {
  getUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Auth session missing' },
  });
  signOut.mockResolvedValue({ error: null });

  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { requireAuth, AuthRequiredError } = await import('./auth.js');
  await expect(requireAuth()).rejects.toBeInstanceOf(AuthRequiredError);
  expect(errSpy).toHaveBeenCalledWith(
    'Not logged in. Run `droppage login` and try again.',
  );
  expect(signOut).toHaveBeenCalled();
  expect(signInWithOtp).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  errSpy.mockRestore();
});

test('requireAuth returns user when getUser succeeds', async () => {
  const user = { id: 'u1', email: 'pub@example.com' };
  getUser.mockResolvedValue({ data: { user }, error: null });

  const { requireAuth } = await import('./auth.js');
  await expect(requireAuth()).resolves.toEqual(user);
  expect(signInWithOtp).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});
