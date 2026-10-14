import { Command } from 'commander';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const fetchQuota = vi.fn();
const requireAuth = vi.fn();
class QuotaRequestError extends Error {}
class AuthRequiredError extends Error {
  constructor() {
    super('auth required');
    this.name = 'AuthRequiredError';
  }
}

vi.mock('../services/quota.js', () => ({
  fetchQuota: (...args: unknown[]) => fetchQuota(...args),
  QuotaRequestError,
}));

vi.mock('../services/auth.js', () => ({
  requireAuth: (...args: unknown[]) => requireAuth(...args),
  AuthRequiredError,
}));

const payload = {
  account: { user_id: 'u1', email: 'owner@example.com', is_admin: false },
  subscription: null,
  entitlements: {
    plan_code: 'starter',
    plan_name: 'Starter',
    can_update: true,
    can_preview: true,
    can_password: true,
    can_email_allowlist: false,
  },
  usage: {
    meter: 'bandwidth',
    used: 1_000_000_000,
    limit: 2_000_000_000,
    percent: 50,
    level: 'normal',
    period_start: '2026-08-01',
    period_end: '2026-09-01',
    pages: { used: 4, limit: 50 },
  },
};

let stdout = '';
let stderr = '';

async function run(...args: string[]): Promise<void> {
  const { registerQuota } = await import('./quota.js');
  const program = new Command();
  program.exitOverride();
  registerQuota(program);
  await program.parseAsync(['node', 'droppage', 'quota', ...args]);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.exitCode = undefined;
  stdout = '';
  stderr = '';
  fetchQuota.mockResolvedValue(payload);
  requireAuth.mockResolvedValue({ id: 'u1' });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderr += args.join(' ') + '\n';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

test('human output puts the quota table on stdout and summary on stderr', async () => {
  await run();

  expect(stdout).toContain('Starter');
  expect(stdout).toContain('4 / 50');
  expect(stdout).toContain('1 GB / 2 GB (50%)');
  expect(stdout).toContain('update, preview, password');
  expect(stderr).toContain('quota level normal');
});

test('--json writes only the unmodified API body to stdout', async () => {
  await run('--json');

  expect(JSON.parse(stdout)).toEqual(payload);
  expect(stderr).toBe('');
});

test('service failures stay off stdout and set a non-zero exit', async () => {
  fetchQuota.mockRejectedValue(new QuotaRequestError('account summary unavailable'));

  await run();

  expect(stdout).toBe('');
  expect(stderr).toContain('account summary unavailable');
  expect(process.exitCode).toBe(1);
});

test('auth gate: missing session is swallowed, nothing on stdout', async () => {
  requireAuth.mockRejectedValue(new AuthRequiredError());

  await run();

  expect(fetchQuota).not.toHaveBeenCalled();
  expect(stdout).toBe('');
});
