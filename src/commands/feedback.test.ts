import { Command } from 'commander';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const submitFeedback = vi.fn();
vi.mock('../services/feedback.js', () => ({
  submitFeedback: (...args: unknown[]) => submitFeedback(...args),
  FeedbackRequestError: class FeedbackRequestError extends Error {},
}));

async function run(...args: string[]) {
  const { registerFeedback } = await import('./feedback.js');
  const program = new Command();
  program.exitOverride();
  registerFeedback(program);
  await program.parseAsync(['node', 'droppage', 'feedback', ...args]);
}

let stdout = '';
let stderr = '';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  stdout = '';
  stderr = '';
  process.exitCode = undefined;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdout += String(chunk); return true; });
  vi.spyOn(console, 'error').mockImplementation((...args) => { stderr += `${args.join(' ')}\n`; });
  submitFeedback.mockResolvedValue({ ok: true, id: 'feedback-123' });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

test('human feedback prints only the id on stdout and thanks on stderr', async () => {
  await run('Please add a command palette', '--kind', 'idea', '--contact', 'ME@example.com');
  expect(stdout).toBe('feedback-123\n');
  expect(stderr).toContain('thanks');
  expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({
    actor: 'human', kind: 'idea', contact: 'me@example.com', source: 'cli',
  }));
});

test('--agent with a model identifies agent feedback', async () => {
  await run('Preview returned the wrong URL', '--kind', 'bug', '--agent', 'gpt-test');
  expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({
    actor: 'agent', model: 'gpt-test', kind: 'bug', cli_version: expect.any(String),
  }));
});

test('review forwards optional rating and quote permission', async () => {
  await run('It works well for weekly reports', '--kind', 'review', '--rating', '5', '--allow-quote');
  expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'review', rating: 5, testimonial_consent: true,
  }));
});

test.each([
  ['idea', '--rating', '5'],
  ['bug', '--allow-quote'],
  ['review', '--rating', '9'],
])('review-only or invalid options fail before submission', async (kind, ...options) => {
  await run('A valid message', '--kind', kind, ...options);
  expect(submitFeedback).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

test('invalid kind fails before the service and leaves stdout empty', async () => {
  await run('A valid message', '--kind', 'feature');
  expect(submitFeedback).not.toHaveBeenCalled();
  expect(stdout).toBe('');
  expect(stderr).toContain('--kind');
  expect(process.exitCode).toBe(1);
});
