import { existsSync, readFileSync } from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const uploadMock = vi.fn();
const deletePageMock = vi.fn();
const submitFeedbackMock = vi.fn();
const uploadImageMock = vi.fn();

vi.mock('../services/auth.js', () => ({
  getCurrentUser: (...a: unknown[]) => getCurrentUserMock(...a),
}));
vi.mock('../services/upload.js', () => ({
  upload: (...a: unknown[]) => uploadMock(...a),
}));
vi.mock('../services/page-images.js', () => ({
  hasLocalImages: async () => false,
  attachLocalImages: async () => ({ html: Buffer.from(''), uploaded: [] }),
  pruneUnusedImages: async () => 0,
}));
vi.mock('../services/pages.js', () => ({
  deletePage: (...a: unknown[]) => deletePageMock(...a),
  listPages: async () => [],
  setPageExpiry: async () => {},
  assertUpdateAllowed: async () => {},
  updatePageHtml: async () => ({ url: 'https://droppage.dev/p/abc' }),
}));
vi.mock('../services/images.js', () => ({
  uploadImage: (...a: unknown[]) => uploadImageMock(...a),
  listImages: async () => ({ images: [] }),
  deleteImage: async (id: string) => id,
}));
vi.mock('../services/feedback.js', () => ({
  submitFeedback: (...a: unknown[]) => submitFeedbackMock(...a),
}));

const OWNER = { id: 'user-1', email: 'Owner@Example.com' };
let stdoutSpy: ReturnType<typeof vi.spyOn>;

async function connect(): Promise<Client> {
  const { createDroppageServer } = await import('./server.js');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createDroppageServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: Boolean(result.isError), text, json: () => JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(OWNER);
  uploadMock.mockResolvedValue('https://droppage.dev/p/NewSlug123');
  stdoutSpy = vi.spyOn(process.stdout, 'write');
});

afterEach(() => {
  // stdout is the protocol in the real server: no tool may print there.
  expect(stdoutSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

test('lists the droppage tools and never offers a password mode', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    'add_recipients', 'delete_media', 'delete_page', 'get_quota', 'list_media', 'list_pages',
    'list_recipients', 'publish_page', 'remove_recipient', 'send_feedback', 'set_page_expiry',
    'update_page', 'upload_media',
  ]);
  const publish = tools.find((tool) => tool.name === 'publish_page')!;
  const access = (publish.inputSchema.properties as Record<string, { enum?: string[] }>).access;
  expect(access.enum).toEqual(['public', 'email', 'private']);
  expect(JSON.stringify(tools)).not.toMatch(/"password"/);
  for (const name of ['delete_page', 'set_page_expiry', 'remove_recipient', 'delete_media', 'update_page']) {
    expect(tools.find((tool) => tool.name === name)!.annotations?.destructiveHint, name).toBe(true);
  }
  expect(client.getInstructions()).toContain('droppage login');
  expect(client.getInstructions()).toContain('frontend-design');
  expect(client.getInstructions()).toContain('no tool changes it');
});

test('signed out: every account tool answers "Not signed in" and makes no call', async () => {
  getCurrentUserMock.mockResolvedValue(null);
  const client = await connect();
  const result = await callTool(client, 'publish_page', { path: 'report.html', access: 'public' });
  expect(result.isError).toBe(true);
  expect(result.text).toContain('Not signed in. Ask the user to run `droppage login` in a terminal, then retry.');
  expect(uploadMock).not.toHaveBeenCalled();
});

test('publish_page private self-allowlists the owner and returns url, slug and warnings', async () => {
  uploadMock.mockImplementation(async () => {
    const { notify } = await import('../lib/notify.js');
    notify('warning', 'HTML references external assets');
    notify('info', 'image chart.png → https://droppage.dev/i/x.png');
    return 'https://droppage.dev/p/NewSlug123';
  });
  const client = await connect();
  const result = await callTool(client, 'publish_page', { path: '/tmp/report.html', access: 'private' });
  expect(result.isError).toBe(false);
  expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
    file: '/tmp/report.html',
    accessMode: 'private',
    allowedEmails: ['owner@example.com'],
  }));
  expect(result.json()).toMatchObject({
    url: 'https://droppage.dev/p/NewSlug123',
    slug: 'NewSlug123',
    access_mode: 'private',
    expires_at: null,
    warnings: ['HTML references external assets'],
  });
});

test('publish_page email validates every address before any upload', async () => {
  const client = await connect();
  const bad = await callTool(client, 'publish_page', { path: 'r.html', access: 'email', emails: ['a@x.com', 'nope'] });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain('invalid email address(es): nope');
  const missing = await callTool(client, 'publish_page', { path: 'r.html', access: 'email' });
  expect(missing.isError).toBe(true);
  expect(uploadMock).not.toHaveBeenCalled();

  const ok = await callTool(client, 'publish_page', { path: 'r.html', access: 'email', emails: [' B@y.com', 'b@y.com'] });
  expect(ok.json()).toMatchObject({ access_mode: 'email', allowed_emails: ['b@y.com'] });
});

test('publish_page needs exactly one of path or html', async () => {
  const client = await connect();
  const both = await callTool(client, 'publish_page', { path: 'r.html', html: '<html></html>', access: 'public' });
  const neither = await callTool(client, 'publish_page', { access: 'public' });
  expect(both.isError && neither.isError).toBe(true);
  expect(both.text).toContain('exactly one of `path` or `html`');
  expect(uploadMock).not.toHaveBeenCalled();
});

test('publish_page html goes through a temp file that is removed afterwards', async () => {
  let seen = '';
  uploadMock.mockImplementation(async ({ file }: { file: string }) => {
    seen = file;
    expect(readFileSync(file, 'utf8')).toBe('<html><body><img src="chart.png"></body></html>');
    return 'https://droppage.dev/p/Inline12345';
  });
  const client = await connect();
  const result = await callTool(client, 'publish_page', {
    html: '<html><body><img src="chart.png"></body></html>',
    access: 'public',
    expires: '7d',
  });
  expect(result.isError).toBe(false);
  expect(seen).toMatch(/droppage-mcp-.*page\.html$/);
  expect(existsSync(seen)).toBe(false);
  const body = result.json();
  expect(body.expires_at).toEqual(expect.any(String));
  expect(body.warnings).toEqual([expect.stringContaining('inline html cannot bring local images or videos')]);
});

test('concurrent calls keep their own warnings', async () => {
  uploadMock.mockImplementation(async ({ file }: { file: string }) => {
    const { notify } = await import('../lib/notify.js');
    await new Promise((r) => setTimeout(r, file.endsWith('a.html') ? 20 : 0));
    notify('warning', `about ${file}`);
    return `https://droppage.dev/p/${file.endsWith('a.html') ? 'Aaaaaaaaaa' : 'Bbbbbbbbbb'}`;
  });
  const client = await connect();
  const [a, b] = await Promise.all([
    callTool(client, 'publish_page', { path: '/tmp/a.html', access: 'public' }),
    callTool(client, 'publish_page', { path: '/tmp/b.html', access: 'public' }),
  ]);
  expect(a.json().warnings).toEqual(['about /tmp/a.html']);
  expect(b.json().warnings).toEqual(['about /tmp/b.html']);
});

test('delete_page reports the service failure as a tool error', async () => {
  deletePageMock.mockResolvedValueOnce({ ok: true, blobWasAbsent: false });
  deletePageMock.mockResolvedValueOnce({ ok: false, partial: false, message: 'page not found or already deleted' });
  const client = await connect();
  expect((await callTool(client, 'delete_page', { slug: 'abc' })).json()).toMatchObject({ deleted: 'abc' });
  const missing = await callTool(client, 'delete_page', { slug: 'gone' });
  expect(missing.isError).toBe(true);
  expect(missing.text).toContain('page not found or already deleted');
  expect(deletePageMock).toHaveBeenCalledWith('abc', OWNER);
});

test('send_feedback is always from an agent, never quotable, and needs no sign-in', async () => {
  getCurrentUserMock.mockResolvedValue(null);
  submitFeedbackMock.mockResolvedValue({ ok: true, id: 'fb-1' });
  const client = await connect();
  const result = await callTool(client, 'send_feedback', { message: 'Great tool', kind: 'review', rating: 5, model: 'test-model' });
  expect(result.json()).toMatchObject({ id: 'fb-1' });
  const sent = submitFeedbackMock.mock.calls[0][0] as Record<string, unknown>;
  expect(sent).toMatchObject({ actor: 'agent', kind: 'review', rating: 5, model: 'test-model', source: 'mcp' });
  expect(sent).not.toHaveProperty('testimonial_consent');
  expect(getCurrentUserMock).not.toHaveBeenCalled();

  const misplaced = await callTool(client, 'send_feedback', { message: 'Nice', rating: 4 });
  expect(misplaced.isError).toBe(true);
});

test('upload_media refuses non-media files before reading them', async () => {
  const client = await connect();
  const result = await callTool(client, 'upload_media', { page: 'abc', paths: ['/home/user/.ssh/id_rsa'] });
  expect(result.isError).toBe(true);
  expect(result.text).toContain('not an image or video file');
});

test('upload_media keeps the files that worked and lists the rest as warnings', async () => {
  uploadImageMock.mockResolvedValueOnce({ id: 'Img000000001', url: 'https://droppage.dev/i/Img000000001.png', bytes: 10, content_type: 'image/png', existing: false });
  uploadImageMock.mockRejectedValueOnce(new Error('image is larger than 4 MB'));
  const client = await connect();
  const result = await callTool(client, 'upload_media', { page: 'abc', paths: ['/tmp/a.png', '/tmp/b.png', '/tmp/notes.txt'] });
  expect(result.isError).toBe(false);
  const body = result.json();
  expect(body.uploaded).toEqual([expect.objectContaining({ file: '/tmp/a.png', id: 'Img000000001' })]);
  expect(body.warnings).toEqual([
    'not uploaded: /tmp/b.png: image is larger than 4 MB',
    expect.stringMatching(/^not uploaded: \/tmp\/notes\.txt: not an image or video file/),
  ]);
});

test('publish_page refuses inline html over 5 MB before writing it anywhere', async () => {
  const client = await connect();
  const result = await callTool(client, 'publish_page', { html: 'x'.repeat(5 * 1024 * 1024 + 1), access: 'public' });
  expect(result.isError).toBe(true);
  expect(uploadMock).not.toHaveBeenCalled();
});
