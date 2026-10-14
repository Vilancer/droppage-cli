import type { User } from '@supabase/supabase-js';
import { beforeEach, expect, test, vi } from 'vitest';

// WR-04: upload() no longer calls requireAuth(); the command is the sole gate
// and threads the resolved publisher in. Tests pass this stub user directly.
const TEST_USER = { id: 'user-123', email: 'pub@example.com' } as User;

const getUser = vi.fn();
const signOut = vi.fn();
const storageUpload = vi.fn();
const storageRemove = vi.fn();
const insert = vi.fn();
const preflight = vi.fn();
// upload() makes two RPC calls: assert_page_create_allowed (preflight) and
// create_page_with_entitlements (the authoritative write). Dispatch by name so
// each has its own mock, and forward both args so assertions on the create call
// keep reading toHaveBeenCalledWith('create_page_with_entitlements', {...}).
const rpc = vi.fn((fn: string, args?: unknown) =>
  fn === 'assert_page_create_allowed' ? preflight(fn, args) : insert(fn, args),
);
const storageFrom = vi.fn(() => ({
  upload: storageUpload,
  remove: storageRemove,
}));
const from = vi.fn(() => ({ insert }));
const readFileMock = vi.fn();
const createClientMock = vi.fn(() => ({
  auth: { getUser, signOut },
  storage: { from: storageFrom },
  from,
  rpc,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('../lib/config.js', () => ({
  getDroppageConfigPath: vi.fn(() => '/tmp/droppage-upload-config.json'),
  createConfStorage: vi.fn(() => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })),
}));

vi.mock('../lib/env.js', () => ({
  resolveSupabaseEnv: vi.fn(() => ({
    url: 'http://127.0.0.1:54321',
    anonKey: 'anon-test-key',
  })),
}));

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

beforeEach(() => {
  // Reset the module graph so the createSupabaseClient() singleton is rebuilt
  // per test (the mocked createClient is then invoked afresh each time).
  vi.resetModules();
  vi.clearAllMocks();
  getUser.mockReset();
  storageUpload.mockReset();
  storageRemove.mockReset();
  insert.mockReset();
  // mockClear, not mockReset: the dispatcher implementation must survive.
  rpc.mockClear();
  preflight.mockReset();
  // The preflight passes unless a test opts into a denial.
  preflight.mockResolvedValue({ error: null });
  readFileMock.mockReset();
  process.exitCode = undefined;
});

function authAsUser(id = 'user-123'): void {
  getUser.mockResolvedValue({
    data: { user: { id, email: 'pub@example.com' } },
    error: null,
  });
}

test('happy path returns the share URL, uploads immutably, inserts a public row', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({
    data: { path: 'ignored' },
    error: null,
  });
  insert.mockResolvedValue({ error: null });

  const { upload } = await import('./upload.js');
  const url = await upload({ file: 'report.html', user: TEST_USER });

  expect(url).toMatch(
    /^https:\/\/droppage\.dev\/p\/[A-Za-z0-9_-]{10}$/,
  );
  const slug = url.slice('https://droppage.dev/p/'.length);

  // Uploaded to {owner_id}/{slug}.html, immutable, text/html.
  expect(storageFrom).toHaveBeenCalledWith('pages');
  const [path, body, opts] = storageUpload.mock.calls[0];
  expect(path).toBe(`user-123/${slug}.html`);
  expect(Buffer.isBuffer(body)).toBe(true);
  expect(opts).toMatchObject({
    contentType: 'text/html; charset=utf-8',
    upsert: false,
  });

  // pages row: slug + owner + public + zero views, storage_path matches object.
  expect(insert).toHaveBeenCalledWith(
    'create_page_with_entitlements',
    expect.objectContaining({
      p_slug: slug,
      p_storage_path: `user-123/${slug}.html`,
      p_access_mode: 'public',
    }),
  );
});

test('with a passwordHash, inserts a password-mode row carrying the hash (D-04)', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({ data: { path: 'ignored' }, error: null });
  insert.mockResolvedValue({ error: null });

  // A fixed bcrypt-shaped hash — the plaintext is hashed by the caller and
  // never reaches this service (T-04-17).
  const HASH = '$2a$10$fixextesthashvalueaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  const { upload } = await import('./upload.js');
  await upload({ file: 'report.html', user: TEST_USER, passwordHash: HASH });

  // The pages row is written as access_mode='password' WITH the hash — mirrors
  // the public-insert assertion above (T-04-19).
  expect(insert).toHaveBeenCalledWith(
    'create_page_with_entitlements',
    expect.objectContaining({
      p_access_mode: 'password',
      p_password_hash: HASH,
    }),
  );
});

test('with allowedEmails + accessMode "email", inserts an email-mode row with the allowlist and no password_hash (ACC-02 / D-08a)', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({ data: { path: 'ignored' }, error: null });
  insert.mockResolvedValue({ error: null });

  const { upload } = await import('./upload.js');
  await upload({
    file: 'report.html',
    user: TEST_USER,
    allowedEmails: ['a@x.com', 'b@y.com'],
    accessMode: 'email',
  });

  expect(insert).toHaveBeenCalledWith(
    'create_page_with_entitlements',
    expect.objectContaining({
      p_access_mode: 'email',
      p_allowed_emails: ['a@x.com', 'b@y.com'],
    }),
  );
  // email rows carry NO password_hash (pages_access_mode_consistency CHECK).
  const row = insert.mock.calls[0][1] as Record<string, unknown>;
  expect(row.p_password_hash).toBeNull();
});

test('with allowedEmails + accessMode "private", inserts a private-mode row with the owner allowlist and no password_hash (ACC-03 / D-04)', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({ data: { path: 'ignored' }, error: null });
  insert.mockResolvedValue({ error: null });

  const { upload } = await import('./upload.js');
  await upload({
    file: 'report.html',
    user: TEST_USER,
    allowedEmails: ['owner@x.com'],
    accessMode: 'private',
  });

  expect(insert).toHaveBeenCalledWith(
    'create_page_with_entitlements',
    expect.objectContaining({
      p_access_mode: 'private',
      p_allowed_emails: ['owner@x.com'],
    }),
  );
  const row = insert.mock.calls[0][1] as Record<string, unknown>;
  expect(row.p_password_hash).toBeNull();
});

test('without a passwordHash, the public row omits password_hash entirely (CHECK)', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({ data: { path: 'ignored' }, error: null });
  insert.mockResolvedValue({ error: null });

  const { upload } = await import('./upload.js');
  await upload({ file: 'report.html', user: TEST_USER });

  // access_mode='public' AND no password_hash key — satisfies the Plan 01
  // pages_password_hash_consistency CHECK (non-password ⇒ NULL) (T-04-19).
  expect(insert).toHaveBeenCalledWith(
    'create_page_with_entitlements',
    expect.objectContaining({ p_access_mode: 'public' }),
  );
  const insertedRow = insert.mock.calls[0][1] as Record<string, unknown>;
  expect(insertedRow.p_password_hash).toBeNull();
});

test('rejects a non-.html file before any network call', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('whatever'));
  const { upload } = await import('./upload.js');
  await expect(upload({ file: 'notes.txt', user: TEST_USER })).rejects.toThrow(
    /expected \.html/i,
  );
  // Validation is pure and runs before any Supabase call.
  expect(storageUpload).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

test('rejects renamed non-HTML content before any network call', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('%PDF-1.4\n%binary'));
  const { upload } = await import('./upload.js');
  await expect(upload({ file: 'report.html', user: TEST_USER })).rejects.toThrow(/html/i);
  expect(storageUpload).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

test('on a 23505 slug collision, removes the orphan object and retries', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body>hi</body>'));
  storageUpload.mockResolvedValue({ data: {}, error: null });
  storageRemove.mockResolvedValue({ data: {}, error: null });
  // First insert collides on the UNIQUE(slug) constraint, second succeeds.
  insert
    .mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } })
    .mockResolvedValueOnce({ error: null });

  const { upload } = await import('./upload.js');
  const url = await upload({ file: 'a.html', user: TEST_USER });

  expect(url).toMatch(
    /^https:\/\/droppage\.dev\/p\/[A-Za-z0-9_-]{10}$/,
  );
  // Two attempts: two uploads, two inserts, one orphan removal.
  expect(storageUpload).toHaveBeenCalledTimes(2);
  expect(insert).toHaveBeenCalledTimes(2);
  expect(storageRemove).toHaveBeenCalledTimes(1);

  // The removed object is the FIRST attempt's path, and it is removed before
  // the second upload (orphan cleanup precedes the retry).
  const firstUploadedPath = storageUpload.mock.calls[0][0];
  expect(storageRemove).toHaveBeenCalledWith([firstUploadedPath]);
  const returnedSlug = url.slice('https://droppage.dev/p/'.length);
  expect(firstUploadedPath).not.toBe(`user-123/${returnedSlug}.html`);
});

test('exhausting MAX_RETRIES throws a clear error and returns no URL', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body>hi</body>'));
  storageUpload.mockResolvedValue({ data: {}, error: null });
  storageRemove.mockResolvedValue({ data: {}, error: null });
  // Every insert collides.
  insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });

  const { upload, MAX_RETRIES } = await import('./upload.js');
  await expect(upload({ file: 'a.html', user: TEST_USER })).rejects.toThrow(/unique slug/i);

  expect(insert).toHaveBeenCalledTimes(MAX_RETRIES);
  expect(storageUpload).toHaveBeenCalledTimes(MAX_RETRIES);
  // Every orphan is cleaned up (one remove per collided attempt).
  expect(storageRemove).toHaveBeenCalledTimes(MAX_RETRIES);
});

test('a non-collision insert error is fatal but still removes the orphan object (WR-01)', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body>hi</body>'));
  storageUpload.mockResolvedValue({ data: {}, error: null });
  storageRemove.mockResolvedValue({ data: {}, error: null });
  insert.mockResolvedValue({
    error: { code: '42501', message: 'row-level security' },
  });

  const { upload } = await import('./upload.js');
  await expect(upload({ file: 'a.html', user: TEST_USER })).rejects.toMatchObject({
    code: '42501',
  });
  expect(insert).toHaveBeenCalledTimes(1);
  // WR-01: a fatal (non-23505) insert error must NOT orphan the uploaded object.
  expect(storageRemove).toHaveBeenCalledTimes(1);
  expect(storageRemove).toHaveBeenCalledWith([storageUpload.mock.calls[0][0]]);
});

test('a failed orphan removal is surfaced on stderr, not silently swallowed (WR-01)', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body>hi</body>'));
  storageUpload.mockResolvedValue({ data: {}, error: null });
  storageRemove.mockResolvedValue({ data: null, error: { message: 'gone' } });
  insert.mockResolvedValue({
    error: { code: '42501', message: 'row-level security' },
  });

  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { upload } = await import('./upload.js');
  await expect(upload({ file: 'a.html', user: TEST_USER })).rejects.toMatchObject({
    code: '42501',
  });
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(/could not remove orphan/i);
  errSpy.mockRestore();
});

test('emits a stderr warning for relative assets but still uploads', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(
    Buffer.from(
      '<!doctype html><body><script src="./app.js"></script></body>',
    ),
  );
  storageUpload.mockResolvedValue({ data: {}, error: null });
  insert.mockResolvedValue({ error: null });

  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { upload } = await import('./upload.js');
  const url = await upload({ file: 'a.html', user: TEST_USER });

  expect(url).toMatch(/^https:\/\/droppage\.dev\/p\//);
  expect(errSpy.mock.calls.flat().join('\n')).toMatch(/warning/i);
  errSpy.mockRestore();
});

test('uses the anon+JWT client, never a service-role key (ARCH-02)', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({ data: {}, error: null });
  insert.mockResolvedValue({ error: null });

  const { upload } = await import('./upload.js');
  await upload({ file: 'a.html', user: TEST_USER });

  // The only client constructed is the anon one from resolveSupabaseEnv.
  expect(createClientMock).toHaveBeenCalledWith(
    'http://127.0.0.1:54321',
    'anon-test-key',
    expect.anything(),
  );
  for (const call of createClientMock.mock.calls) {
    const key = String(call[1] ?? '');
    expect(key).not.toMatch(/service_role|sb_secret/i);
  }
});

test('propagates a storage upload error and never inserts a row', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({
    data: null,
    error: { message: 'bucket denied' },
  });

  const { upload } = await import('./upload.js');
  await expect(upload({ file: 'a.html', user: TEST_USER })).rejects.toMatchObject({
    message: 'bucket denied',
  });
  expect(insert).not.toHaveBeenCalled();
});

test('runs the create preflight before any storage write', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({ data: { path: 'p' }, error: null });
  insert.mockResolvedValue({ error: null });

  const { upload } = await import('./upload.js');
  await upload({ file: 'a.html', user: TEST_USER });

  expect(preflight).toHaveBeenCalledWith('assert_page_create_allowed', {
    p_access_mode: 'public',
    p_recipient_count: 0,
  });
  expect(preflight.mock.invocationCallOrder[0]).toBeLessThan(
    storageUpload.mock.invocationCallOrder[0],
  );
});

test('a denied preflight surfaces the server message and uploads nothing', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  preflight.mockResolvedValue({
    error: {
      code: 'P0001',
      message: 'page quota reached (5 of 5); delete a page or upgrade',
    },
  });

  const { upload } = await import('./upload.js');
  const failure = upload({ file: 'a.html', user: TEST_USER });
  await expect(failure).rejects.toMatchObject({
    message: 'page quota reached (5 of 5); delete a page or upgrade',
  });
  // supabase-js hands back a PLAIN object, not an Error. It must be normalized
  // here or the command's `String(err)` fallback prints "[object Object]" and
  // the server's wording (plus the quota hint keyed off it) is lost.
  await expect(failure).rejects.toBeInstanceOf(Error);
  // The whole point of the preflight: no wasted body upload, no orphan object,
  // no row, and nothing to clean up.
  expect(storageUpload).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(storageRemove).not.toHaveBeenCalled();
});

test('the preflight runs once even when slug collisions force retries', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({ data: { path: 'p' }, error: null });
  storageRemove.mockResolvedValue({ data: null, error: null });
  insert
    .mockResolvedValueOnce({ error: { code: '23505' } })
    .mockResolvedValueOnce({ error: { code: '23505' } })
    .mockResolvedValueOnce({ error: null });

  const { upload } = await import('./upload.js');
  await upload({ file: 'a.html', user: TEST_USER });

  expect(preflight).toHaveBeenCalledTimes(1);
  expect(storageUpload).toHaveBeenCalledTimes(3);
});

test.for([
  {
    label: 'password',
    args: { passwordHash: '$2a$10$hash' },
    expected: { p_access_mode: 'password', p_recipient_count: 0 },
  },
  {
    label: 'email',
    args: {
      accessMode: 'email' as const,
      allowedEmails: ['a@example.com', 'b@example.com'],
    },
    expected: { p_access_mode: 'email', p_recipient_count: 2 },
  },
  {
    label: 'private',
    args: { accessMode: 'private' as const, allowedEmails: ['owner@example.com'] },
    expected: { p_access_mode: 'private', p_recipient_count: 1 },
  },
])('the preflight carries the resolved access mode and recipient count: $label', async ({ args, expected }) => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({ data: { path: 'p' }, error: null });
  insert.mockResolvedValue({ error: null });

  const { upload } = await import('./upload.js');
  await upload({ file: 'a.html', user: TEST_USER, ...args });

  expect(preflight).toHaveBeenCalledWith('assert_page_create_allowed', expected);
});

test('a storage RLS denial after a passing preflight gets quota guidance', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({
    data: null,
    error: { message: 'new row violates row-level security policy' },
  });

  const { upload } = await import('./upload.js');
  const failure = upload({ file: 'a.html', user: TEST_USER });
  // The server's own text is preserved; the CLI adds a pointer, not a diagnosis.
  await expect(failure).rejects.toThrow(/new row violates row-level security policy/);
  await expect(failure).rejects.toThrow(/droppage quota/);
  expect(insert).not.toHaveBeenCalled();
});

test('an unrelated storage error keeps its raw message and gains no quota hint', async () => {
  authAsUser();
  readFileMock.mockResolvedValue(Buffer.from('<!doctype html><body><h1>hi</h1></body>'));
  storageUpload.mockResolvedValue({
    data: null,
    error: { message: 'bucket denied' },
  });

  const { upload } = await import('./upload.js');
  await expect(upload({ file: 'a.html', user: TEST_USER })).rejects.not.toThrow(
    /droppage quota/,
  );
});
