import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const getSession = vi.fn();
vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: () => ({ auth: { getSession } }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.DROPPAGE_SHARE_BASE_URL = 'https://serve.test';
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DROPPAGE_SHARE_BASE_URL;
});

test('fetches /api/account with the current bearer session', async () => {
  const payload = { account: {}, subscription: null, entitlements: {}, usage: {} };
  fetchMock.mockResolvedValue(Response.json(payload));
  const { fetchQuota } = await import('./quota.js');

  await expect(fetchQuota()).resolves.toEqual(payload);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://serve.test/api/account',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer jwt-123' }),
    }),
  );
});

test('fails before the network when signed out', async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  const { fetchQuota, QuotaRequestError } = await import('./quota.js');

  await expect(fetchQuota()).rejects.toBeInstanceOf(QuotaRequestError);
  await expect(fetchQuota()).rejects.toThrow(/droppage login/);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('preserves a server error message and status', async () => {
  fetchMock.mockResolvedValue(Response.json({ error: 'account summary unavailable' }, { status: 500 }));
  const { fetchQuota } = await import('./quota.js');

  await expect(fetchQuota()).rejects.toMatchObject({
    name: 'QuotaRequestError',
    status: 500,
    message: 'account summary unavailable',
  });
});

test('rejects a 200 body that is missing usage or entitlements', async () => {
  fetchMock.mockResolvedValue(Response.json({ account: {} }));
  const { fetchQuota, QuotaRequestError } = await import('./quota.js');

  await expect(fetchQuota()).rejects.toBeInstanceOf(QuotaRequestError);
});
