import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };

const getSession = vi.fn();
vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: () => ({ auth: { getSession } }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.DROPPAGE_SHARE_BASE_URL = 'https://serve.test';
  getSession.mockResolvedValue({ data: { session: null } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DROPPAGE_SHARE_BASE_URL;
});

test('submits anonymously when no session exists', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, id: 'f-1' }));
  vi.stubGlobal('fetch', fetchMock);
  const { submitFeedback } = await import('./feedback.js');
  const result = await submitFeedback({
    message: 'An idea', kind: 'idea', actor: 'human', source: 'cli', cli_version: pkg.version,
  });
  expect(result.id).toBe('f-1');
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
});

test('attaches a bearer token when a session exists', async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1' } } });
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, id: 'f-2' }));
  vi.stubGlobal('fetch', fetchMock);
  const { submitFeedback } = await import('./feedback.js');
  await submitFeedback({
    message: 'A bug', kind: 'bug', actor: 'agent', model: 'test-model', source: 'cli', cli_version: pkg.version,
  });
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-1');
});

test('surfaces server errors with status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'too many' }, { status: 429 })));
  const { submitFeedback } = await import('./feedback.js');
  await expect(submitFeedback({
    message: 'Again', kind: 'other', actor: 'human', source: 'cli', cli_version: pkg.version,
  })).rejects.toMatchObject({ status: 429, message: 'too many' });
});
