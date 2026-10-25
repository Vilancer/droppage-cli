import { Command } from 'commander';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { z } from 'zod';

const uploadMock = vi.fn();
const requireAuthMock = vi.fn();
// D-04: masked `password` prompt from @inquirer/prompts, mocked so the command
// test drives the interactive path without a TTY (precedent: auth.test.ts:52).
const passwordPromptMock = vi.fn();

class AuthRequiredError extends Error {
  constructor() {
    super('auth required');
    this.name = 'AuthRequiredError';
  }
}

vi.mock('../services/page-images.js', () => ({
  hasLocalImages: async () => false,
  attachLocalImages: async () => ({ html: Buffer.from(''), uploaded: [] }),
}));

const inviteMock = vi.fn();
vi.mock('../services/recipients.js', () => ({
  inviteRecipients: (...args: unknown[]) => inviteMock(...args),
}));

vi.mock('../services/upload.js', () => ({
  upload: (...args: unknown[]) => uploadMock(...args),
}));

// D-07: the command validates every --email value with the SAME z.email() schema
// the auth service exports. Mock it with the real schema so validate-before-network
// behavior is exercised faithfully (not a stub that always passes).
vi.mock('../services/auth.js', () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  emailSchema: z.email(),
  AuthRequiredError,
}));

vi.mock('@inquirer/prompts', () => ({
  password: (...args: unknown[]) => passwordPromptMock(...args),
}));

async function run(...args: string[]): Promise<void> {
  const { registerUpload } = await import('./upload.js');
  const program = new Command();
  program.exitOverride(); // never call process.exit() in tests
  registerUpload(program);
  await program.parseAsync(['node', 'droppage', 'upload', ...args]);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  uploadMock.mockReset();
  requireAuthMock.mockReset();
  passwordPromptMock.mockReset();
  inviteMock.mockReset();
  inviteMock.mockResolvedValue({ slug: 'abcdefghij', queued: 0, invited: [] });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('stdout carries ONLY the bare URL; status goes to stderr (D-10)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  const url = 'https://droppage.dev/p/abcdefghij';
  uploadMock.mockResolvedValue(url);

  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html');

  // Exactly one stdout write, and it is the bare URL + newline.
  expect(outSpy).toHaveBeenCalledTimes(1);
  expect(outSpy).toHaveBeenCalledWith(`${url}\n`);

  // Status lines exist on stderr and never leak the URL.
  const errText = errSpy.mock.calls.flat().join('\n');
  expect(errText).toMatch(/uploading|done/i);
  expect(errText).not.toContain(url);
  expect(process.exitCode).toBeUndefined();
});

test('on failure: error to stderr, exit code 1, stdout empty', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  uploadMock.mockRejectedValue(new Error('Content does not look like HTML'));

  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('bad.html');

  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(
    /upload failed: Content does not look like HTML/i,
  );
});

test.each([
  'page quota reached for this account',
  'password pages require Starter or Builder',
  // The exact wording raised by assert_page_create_allowed /
  // create_page_with_entitlements, pinning the hint to the real server text.
  'page quota reached (5 of 5); delete a page or upgrade',
  'monthly quota reached; existing links remain live until the next UTC month',
])('quota/plan failure adds actionable quota guidance: %s', async (message) => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  uploadMock.mockRejectedValue(new Error(message));
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html');

  expect(outSpy).not.toHaveBeenCalled();
  expect(errSpy.mock.calls.flat().join('\n')).toContain(
    'run `droppage quota` to see your limits',
  );
  expect(process.exitCode).toBe(1);
});

test('unrelated upload failures do not suggest quota', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  uploadMock.mockRejectedValue(new Error('Content does not look like HTML'));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('bad.html');

  expect(errSpy.mock.calls.flat().join('\n')).not.toContain('droppage quota');
});

test('auth gate: missing session is swallowed, nothing on stdout', async () => {
  requireAuthMock.mockRejectedValue(new AuthRequiredError());

  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html');

  expect(uploadMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
});

test('--password prompts twice (masked) and threads a HASH, never the plaintext, into upload (D-04)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  const url = 'https://droppage.dev/p/abcdefghij';
  uploadMock.mockResolvedValue(url);
  const PLAINTEXT = 'sw0rdfish';
  // Both the value prompt and the confirm prompt resolve to the same secret.
  passwordPromptMock
    .mockResolvedValueOnce(PLAINTEXT)
    .mockResolvedValueOnce(PLAINTEXT);

  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--password');

  // Prompted exactly twice (value + confirm), both masked.
  expect(passwordPromptMock).toHaveBeenCalledTimes(2);
  for (const call of passwordPromptMock.mock.calls) {
    expect(call[0]).toMatchObject({ mask: expect.any(String) });
  }

  // upload() received a bcrypt hash — NOT the plaintext (T-04-17).
  expect(uploadMock).toHaveBeenCalledTimes(1);
  const arg = uploadMock.mock.calls[0][0] as { passwordHash?: string };
  expect(typeof arg.passwordHash).toBe('string');
  expect(arg.passwordHash).not.toBe(PLAINTEXT);
  expect(arg.passwordHash).toMatch(/^\$2[aby]?\$/); // bcrypt hash prefix
  expect(arg.passwordHash!.length).toBeGreaterThan(0);

  // stdout still carries ONLY the bare URL (D-10); the plaintext never leaks.
  expect(outSpy).toHaveBeenCalledTimes(1);
  expect(outSpy).toHaveBeenCalledWith(`${url}\n`);
  const errText = errSpy.mock.calls.flat().join('\n');
  expect(errText).not.toContain(PLAINTEXT);
});

test('--password mismatch throws before any upload; nothing on stdout, exit 1 (D-04)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  // The confirm prompt differs from the first value → mismatch.
  passwordPromptMock
    .mockResolvedValueOnce('sw0rdfish')
    .mockResolvedValueOnce('typo-mismatch');

  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--password');

  // The action surfaces the mismatch and never reaches the network.
  expect(uploadMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(
    /passwords do not match/i,
  );
});

test('without --password: the prompt is never invoked and upload gets no passwordHash', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' });
  const url = 'https://droppage.dev/p/abcdefghij';
  uploadMock.mockResolvedValue(url);

  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html');

  expect(passwordPromptMock).not.toHaveBeenCalled();
  expect(uploadMock).toHaveBeenCalledTimes(1);
  const arg = uploadMock.mock.calls[0][0] as { passwordHash?: string };
  expect(arg.passwordHash).toBeUndefined();
});

// ─── --email allowlist (D-05): repeatable + comma-split + trim/lower/dedupe ───

test('--email repeated across flags collects both addresses (D-05)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const url = 'https://droppage.dev/p/abcdefghij';
  uploadMock.mockResolvedValue(url);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--email', 'a@x.com', '--email', 'b@y.com');

  expect(uploadMock).toHaveBeenCalledTimes(1);
  const arg = uploadMock.mock.calls[0][0] as {
    allowedEmails?: string[];
    accessMode?: string;
  };
  expect(arg.allowedEmails).toEqual(['a@x.com', 'b@y.com']);
  expect(arg.accessMode).toBe('email');
});

test('--email comma-separated in a single flag collects both addresses (D-05)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const url = 'https://droppage.dev/p/abcdefghij';
  uploadMock.mockResolvedValue(url);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--email', 'a@x.com,b@y.com');

  const arg = uploadMock.mock.calls[0][0] as { allowedEmails?: string[] };
  expect(arg.allowedEmails).toEqual(['a@x.com', 'b@y.com']);
});

test('--email trims, lowercases, and dedupes mixed-case/whitespace values (D-05)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const url = 'https://droppage.dev/p/abcdefghij';
  uploadMock.mockResolvedValue(url);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--email', '  Alice@X.com , alice@x.com ');

  const arg = uploadMock.mock.calls[0][0] as { allowedEmails?: string[] };
  expect(arg.allowedEmails).toEqual(['alice@x.com']);
});

// ─── --private self-allowlist (D-04) ───

test('--private self-allowlists the owner email (lowercased) as a private page (D-04)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'Owner@X.com' });
  const url = 'https://droppage.dev/p/abcdefghij';
  uploadMock.mockResolvedValue(url);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--private');

  expect(uploadMock).toHaveBeenCalledTimes(1);
  const arg = uploadMock.mock.calls[0][0] as {
    allowedEmails?: string[];
    accessMode?: string;
  };
  expect(arg.allowedEmails).toEqual(['owner@x.com']);
  expect(arg.accessMode).toBe('private');
});

test('--private with an account that has no email errors before any upload (D-04)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1' }); // no .email
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--private');

  expect(uploadMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(/private/i);
});

// ─── mutual exclusivity (D-06) — validate before network ───

test('--email + --password is a hard error: exit 1, no upload() call (D-06)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--email', 'a@x.com', '--password');

  // No network: neither the password prompt nor upload() runs.
  expect(uploadMock).not.toHaveBeenCalled();
  expect(passwordPromptMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(
    /mutual|exclusive|one access mode/i,
  );
});

test('--private + --email is a hard error: exit 1, no upload() call (D-06)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--private', '--email', 'a@x.com');

  expect(uploadMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(
    /mutual|exclusive|one access mode/i,
  );
});

test('--private + --password is a hard error: exit 1, no upload() call (D-06)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--private', '--password');

  expect(uploadMock).not.toHaveBeenCalled();
  expect(passwordPromptMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

// ─── email validation (D-07) — reject the whole upload, name the bad value ───

test('an invalid --email value rejects the upload before any network call, naming it (D-07)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--email', 'a@x.com,not-an-email');

  // Whole upload rejected — no recipient silently dropped, no network call.
  expect(uploadMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  const errText = errSpy.mock.calls.flat().join('\n');
  expect(errText).toMatch(/not-an-email/);
});

test('--email with only empty values (comma/whitespace) errors, never a silent public upload (D-07)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--email', ' , ');

  expect(uploadMock).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

test('no mode flag → upload() gets public accessMode and no allowlist (unchanged)', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'pub@example.com' });
  const url = 'https://droppage.dev/p/abcdefghij';
  uploadMock.mockResolvedValue(url);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html');

  const arg = uploadMock.mock.calls[0][0] as {
    allowedEmails?: string[];
    accessMode?: string;
  };
  expect(arg.allowedEmails).toBeUndefined();
  expect(arg.accessMode).toBe('public');
});

test('--email invites the listed people after publishing; stdout stays the URL', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'owner@x.com' });
  uploadMock.mockResolvedValue('https://droppage.dev/p/abcdefghij');
  inviteMock.mockResolvedValue({ slug: 'abcdefghij', queued: 2, invited: ['a@x.com', 'b@x.com'] });
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--email', 'a@x.com,b@x.com');

  expect(inviteMock).toHaveBeenCalledWith('abcdefghij');
  expect(outSpy.mock.calls).toEqual([['https://droppage.dev/p/abcdefghij\n']]);
  expect(errSpy.mock.calls.flat().join('\n')).toContain('2 invitation(s) queued: a@x.com, b@x.com');
  expect(process.exitCode).toBeUndefined();
});

test('--email --no-invite publishes without emailing and says how to send later', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'owner@x.com' });
  uploadMock.mockResolvedValue('https://droppage.dev/p/abcdefghij');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html', '--email', 'a@x.com', '--no-invite');

  expect(inviteMock).not.toHaveBeenCalled();
  expect(errSpy.mock.calls.flat().join('\n')).toContain('no invitations sent; send them with `droppage recipients invite abcdefghij` when ready');
});

test('public and private uploads never call the invite endpoint', async () => {
  requireAuthMock.mockResolvedValue({ id: 'u1', email: 'owner@x.com' });
  uploadMock.mockResolvedValue('https://droppage.dev/p/abcdefghij');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await run('report.html');
  await run('report.html', '--private');

  expect(inviteMock).not.toHaveBeenCalled();
});
