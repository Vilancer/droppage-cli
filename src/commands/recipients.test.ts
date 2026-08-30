import { Command } from 'commander';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const listRecipientsMock = vi.fn();
const addRecipientsMock = vi.fn();
const removeRecipientMock = vi.fn();
const resendRecipientMock = vi.fn();
const requireAuthMock = vi.fn();
const confirmMock = vi.fn();

class AuthRequiredError extends Error {
  constructor() {
    super('auth required');
    this.name = 'AuthRequiredError';
  }
}

class RecipientRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RecipientRequestError';
  }
}

vi.mock('../services/recipients.js', () => ({
  listRecipients: (...a: unknown[]) => listRecipientsMock(...a),
  addRecipients: (...a: unknown[]) => addRecipientsMock(...a),
  removeRecipient: (...a: unknown[]) => removeRecipientMock(...a),
  resendRecipient: (...a: unknown[]) => resendRecipientMock(...a),
  RecipientRequestError,
}));

vi.mock('../services/auth.js', () => ({
  requireAuth: (...a: unknown[]) => requireAuthMock(...a),
  AuthRequiredError,
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: (...a: unknown[]) => confirmMock(...a),
}));

async function run(...args: string[]): Promise<void> {
  const { registerRecipients } = await import('./recipients.js');
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {} });
  registerRecipients(program);
  await program.parseAsync(['node', 'droppage', 'recipients', ...args]);
}

const recipient = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  email: 'a@example.com',
  status: 'active',
  invitation_status: 'sent',
  last_sent_at: '2026-08-23T10:00:00.000Z',
  created_at: '2026-08-20T10:00:00.000Z',
  ...over,
});

let stdout: string;
let stderr: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ id: 'user-1', email: 'owner@example.com' });
  process.exitCode = undefined;
  stdout = '';
  stderr = '';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderr += args.join(' ') + '\n';
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.exitCode = undefined;
});

// --- list ------------------------------------------------------------------

test('list renders a table on stdout and a count on stderr', async () => {
  listRecipientsMock.mockResolvedValue({
    slug: 'abc', page: 1, page_size: 50, total: 1, recipients: [recipient()],
  });
  await run('list', 'abc');
  expect(stdout).toContain('EMAIL');
  expect(stdout).toContain('a@example.com');
  expect(stdout).toContain('sent');
  expect(stderr).toContain('1 of 1 recipient(s)');
});

test('list --json prints the raw payload to stdout and nothing to stderr', async () => {
  const payload = {
    slug: 'abc', page: 1, page_size: 50, total: 1, recipients: [recipient()],
  };
  listRecipientsMock.mockResolvedValue(payload);
  await run('list', 'abc', '--json');
  expect(JSON.parse(stdout)).toEqual(payload);
  expect(stderr).toBe('');
});

test('list with no recipients keeps stdout empty and explains on stderr', async () => {
  listRecipientsMock.mockResolvedValue({
    slug: 'abc', page: 1, page_size: 50, total: 0, recipients: [],
  });
  await run('list', 'abc');
  expect(stdout).toBe('');
  expect(stderr).toContain('no recipients');
});

test('list --json on an empty page still emits valid parseable JSON', async () => {
  listRecipientsMock.mockResolvedValue({
    slug: 'abc', page: 1, page_size: 50, total: 0, recipients: [],
  });
  await run('list', 'abc', '--json');
  expect(JSON.parse(stdout).recipients).toEqual([]);
});

test('list passes a valid page number through and falls back on a bad one', async () => {
  listRecipientsMock.mockResolvedValue({
    slug: 'abc', page: 2, page_size: 50, total: 0, recipients: [],
  });
  await run('list', 'abc', '--page', '2');
  expect(listRecipientsMock).toHaveBeenCalledWith('abc', expect.anything(), 2);

  await run('list', 'abc', '--page', 'banana');
  expect(listRecipientsMock).toHaveBeenLastCalledWith('abc', expect.anything(), 1);
});

test('a never-sent recipient renders an em dash, not "null"', async () => {
  listRecipientsMock.mockResolvedValue({
    slug: 'abc', page: 1, page_size: 50, total: 1,
    recipients: [recipient({ last_sent_at: null, invitation_status: 'queued' })],
  });
  await run('list', 'abc');
  expect(stdout).toContain('—');
  expect(stdout).not.toContain('null');
});

// --- add -------------------------------------------------------------------

test('add normalizes and dedupes before calling the service', async () => {
  addRecipientsMock.mockResolvedValue({ slug: 'abc', queued: 1, unchanged: 0, recipients: [] });
  await run('add', 'abc', '  A@Example.COM ', 'a@example.com');
  expect(addRecipientsMock).toHaveBeenCalledWith('abc', ['a@example.com'], expect.anything());
});

test('add reports queued vs already-had-access counts', async () => {
  addRecipientsMock.mockResolvedValue({ slug: 'abc', queued: 2, unchanged: 1, recipients: [] });
  await run('add', 'abc', 'a@x.com', 'b@x.com', 'c@x.com');
  expect(stderr).toContain('2 invitation(s) queued');
  expect(stderr).toContain('1 already had access');
});

test('add says "queued", never "sent" — delivery is asynchronous', async () => {
  addRecipientsMock.mockResolvedValue({ slug: 'abc', queued: 1, unchanged: 0, recipients: [] });
  await run('add', 'abc', 'a@x.com');
  expect(stderr).toContain('queued');
  expect(stderr).not.toMatch(/\bsent\b/);
});

test('add rejects an invalid address by name BEFORE any network call', async () => {
  await run('add', 'abc', 'ok@x.com', 'not-an-email');
  expect(addRecipientsMock).not.toHaveBeenCalled();
  expect(stderr).toContain('invalid email address(es): not-an-email');
  expect(process.exitCode).toBe(1);
});

test('a service error is reported on stderr with a non-zero exit', async () => {
  addRecipientsMock.mockRejectedValue(
    new RecipientRequestError('recipient limit exceeded: 100 active + 1 new > 100 allowed', 409),
  );
  await run('add', 'abc', 'a@x.com');
  expect(stderr).toContain('recipient limit exceeded');
  expect(process.exitCode).toBe(1);
});

// --- remove ----------------------------------------------------------------

test('remove prompts by default and aborts without calling the service on "no"', async () => {
  confirmMock.mockResolvedValue(false);
  await run('remove', 'abc', 'a@x.com');
  expect(confirmMock).toHaveBeenCalledTimes(1);
  expect(removeRecipientMock).not.toHaveBeenCalled();
  expect(stderr).toContain('aborted');
  expect(process.exitCode).toBeUndefined();
});

test('remove proceeds when confirmed', async () => {
  confirmMock.mockResolvedValue(true);
  removeRecipientMock.mockResolvedValue(undefined);
  await run('remove', 'abc', 'A@X.com');
  expect(removeRecipientMock).toHaveBeenCalledWith('abc', 'a@x.com', expect.anything());
  expect(stderr).toContain('no longer works');
});

test('remove --yes skips the prompt', async () => {
  removeRecipientMock.mockResolvedValue(undefined);
  await run('remove', 'abc', 'a@x.com', '--yes');
  expect(confirmMock).not.toHaveBeenCalled();
  expect(removeRecipientMock).toHaveBeenCalledTimes(1);
});

test('remove surfaces the last-recipient guard', async () => {
  removeRecipientMock.mockRejectedValue(
    new RecipientRequestError('cannot remove the last recipient of a email page', 400),
  );
  await run('remove', 'abc', 'a@x.com', '--yes');
  expect(stderr).toContain('cannot remove the last recipient');
  expect(process.exitCode).toBe(1);
});

// --- resend ----------------------------------------------------------------

test('resend queues one invitation', async () => {
  resendRecipientMock.mockResolvedValue(undefined);
  await run('resend', 'abc', ' A@X.com ');
  expect(resendRecipientMock).toHaveBeenCalledWith('abc', 'a@x.com', expect.anything());
  expect(stderr).toContain('queued');
});

test('resend to a non-recipient reports the server message', async () => {
  resendRecipientMock.mockRejectedValue(
    new RecipientRequestError('no active recipient a@x.com on this page', 400),
  );
  await run('resend', 'abc', 'a@x.com');
  expect(stderr).toContain('no active recipient');
  expect(process.exitCode).toBe(1);
});

// --- auth ------------------------------------------------------------------

test('an unauthenticated caller exits quietly without touching the service', async () => {
  requireAuthMock.mockRejectedValue(new AuthRequiredError());
  await run('list', 'abc');
  expect(listRecipientsMock).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});
