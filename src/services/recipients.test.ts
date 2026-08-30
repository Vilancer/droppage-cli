import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const getSessionMock = vi.fn();
vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: () => ({ auth: { getSession: getSessionMock } }),
}));

const USER = { id: 'user-1' } as never;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.DROPPAGE_SHARE_BASE_URL = 'https://serve.test';
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DROPPAGE_SHARE_BASE_URL;
});

test('list GETs the paginated endpoint with a bearer token', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ slug: 'abc', recipients: [] }));
  const { listRecipients } = await import('./recipients.js');
  await listRecipients('abc', USER, 3);

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://serve.test/api/pages/abc/recipients?page=3');
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBe('Bearer jwt-123');
});

test('slugs and emails are URL-encoded, not interpolated raw', async () => {
  fetchMock.mockResolvedValue(jsonResponse({}));
  const { removeRecipient } = await import('./recipients.js');
  await removeRecipient('a/b?c', 'user+tag@example.com', USER);

  const [url] = fetchMock.mock.calls[0];
  expect(url).toBe(
    'https://serve.test/api/pages/a%2Fb%3Fc/recipients?email=user%2Btag%40example.com',
  );
});

test('add POSTs the email array as JSON', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ slug: 'abc', queued: 2, unchanged: 0, recipients: [] }));
  const { addRecipients } = await import('./recipients.js');
  const result = await addRecipients('abc', ['a@x.com', 'b@x.com'], USER);

  const [, init] = fetchMock.mock.calls[0];
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ emails: ['a@x.com', 'b@x.com'] });
  expect(result.queued).toBe(2);
});

test('resend POSTs the resend action', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ queued: true }));
  const { resendRecipient } = await import('./recipients.js');
  await resendRecipient('abc', 'a@x.com', USER);

  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(init.body)).toEqual({ action: 'resend', email: 'a@x.com' });
});

test('a signed-out caller fails before any network call', async () => {
  getSessionMock.mockResolvedValue({ data: { session: null } });
  const { listRecipients, RecipientRequestError } = await import('./recipients.js');
  await expect(listRecipients('abc', USER)).rejects.toThrow(RecipientRequestError);
  await expect(listRecipients('abc', USER)).rejects.toThrow(/droppage login/);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a server error message is surfaced verbatim, with its status", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ error: 'recipient limit exceeded: 100 active + 1 new > 100 allowed' }, 409),
  );
  const { addRecipients, RecipientRequestError } = await import('./recipients.js');
  await expect(addRecipients('abc', ['a@x.com'], USER)).rejects.toMatchObject({
    name: 'RecipientRequestError',
    status: 409,
    message: 'recipient limit exceeded: 100 active + 1 new > 100 allowed',
  });
  expect(RecipientRequestError).toBeDefined();
});

test('a non-JSON error body still yields a usable message', async () => {
  // e.g. a CDN/proxy HTML error page rather than the app's JSON.
  fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
  const { addRecipients } = await import('./recipients.js');
  await expect(addRecipients('abc', ['a@x.com'], USER)).rejects.toThrow(/HTTP 502/);
});

test('an unreachable serve tier is reported as connectivity, not a user error', async () => {
  fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
  const { listRecipients } = await import('./recipients.js');
  await expect(listRecipients('abc', USER)).rejects.toMatchObject({ status: 0 });
  await expect(listRecipients('abc', USER)).rejects.toThrow(/could not reach https:\/\/serve\.test/);
});

test('an empty 200 body does not throw', async () => {
  fetchMock.mockResolvedValue(new Response('', { status: 200 }));
  const { removeRecipient } = await import('./recipients.js');
  await expect(removeRecipient('abc', 'a@x.com', USER)).resolves.toBeUndefined();
});
