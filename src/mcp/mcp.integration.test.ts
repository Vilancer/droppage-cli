/**
 * `droppage mcp` end to end: spawns the BUILT CLI (dist/cli.js) as an MCP stdio
 * server against a LIVE local Supabase stack and drives it with a real MCP
 * client: publish → list → update → expire → delete.
 *
 * Guarded like upload.integration.test.ts: runs only when SUPABASE_URL + an anon
 * key + SUPABASE_SERVICE_ROLE_KEY are exported, the REST endpoint answers and
 * dist/cli.js exists; otherwise each test SKIPS. update_page also needs the serve
 * app (DROPPAGE_SHARE_BASE_URL, default http://127.0.0.1:3000) and skips that
 * step without it. The service-role key only creates and removes the test user
 * here; it is never passed to the spawned CLI.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, test } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.DROPPAGE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.DROPPAGE_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SHARE_BASE = process.env.DROPPAGE_SHARE_BASE_URL ?? 'http://127.0.0.1:3000';
const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

const hasEnv = Boolean(ANON_KEY && SERVICE_ROLE_KEY && existsSync(CLI));
let ready = false;
let serveUp = false;
let admin: SupabaseClient | undefined;
let userId = '';
let tmpDir = '';
let client: Client | undefined;
const testEmail = `mcp-${randomUUID()}@example.com`;

async function reachable(url: string, headers: Record<string, string> = {}): Promise<boolean> {
  try {
    return (await fetch(url, { headers })).status < 500;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  if (!hasEnv || !(await reachable(`${SUPABASE_URL}/rest/v1/`, { apikey: ANON_KEY }))) return;
  serveUp = await reachable(`${SHARE_BASE}/health`);

  tmpDir = await mkdtemp(join(tmpdir(), 'droppage-mcp-it-'));
  const home = join(tmpDir, 'home');
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const password = `Pw-${randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email: testEmail, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user?.id ?? '';
  // Updates need a paid plan; admins get every feature (as in upload.integration.test.ts).
  const promoted = await admin.from('admin_users').insert({ user_id: userId });
  if (promoted.error) throw promoted.error;

  // Sign in through the CLI's own session store under a throwaway HOME, the way
  // `droppage login` leaves it; the spawned server reads the same file.
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  try {
    const { createSupabaseClient } = await import('../lib/supabase.js');
    const signIn = await createSupabaseClient().auth.signInWithPassword({ email: testEmail, password });
    if (signIn.error) throw signIn.error;
  } finally {
    process.env.HOME = previousHome;
  }

  client = new Client({ name: 'droppage-it', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'mcp'],
    cwd: tmpDir,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      SUPABASE_URL,
      SUPABASE_ANON_KEY: ANON_KEY,
      DROPPAGE_SHARE_BASE_URL: SHARE_BASE,
      DROPPAGE_NO_UPDATE_CHECK: '1',
    },
    stderr: 'ignore',
  }));
  ready = true;
}, 60_000);

afterAll(async () => {
  await client?.close().catch(() => {});
  if (admin && userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function tool(name: string, args: Record<string, unknown> = {}) {
  const result = await client!.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0].text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text) as Record<string, unknown>;
}

test('publish → list → update → expire → delete over stdio', async (ctx) => {
  if (!ready) {
    console.warn('[skip] droppage mcp integration: needs local Supabase env + reachable stack + a built dist/cli.js');
    ctx.skip();
    return;
  }

  const file = join(tmpDir, 'report.html');
  await writeFile(file, '<!doctype html><html><body><h1>MCP v1</h1></body></html>');
  const published = await tool('publish_page', { path: file, access: 'private' });
  expect(published).toMatchObject({ access_mode: 'private', warnings: [] });
  const slug = published.slug as string;
  expect(published.url).toBe(`${SHARE_BASE}/p/${slug}`);

  const listed = await tool('list_pages');
  expect(listed.pages).toEqual([
    expect.objectContaining({ slug, access_mode: 'private', allowed_emails: [testEmail], expires_at: null }),
  ]);

  if (serveUp) {
    await writeFile(file, '<!doctype html><html><body><h1>MCP v2</h1></body></html>');
    expect(await tool('update_page', { slug, path: file })).toMatchObject({ slug, url: published.url });
  } else {
    console.warn(`[skip] update_page: serve app not reachable at ${SHARE_BASE}`);
  }

  const expiry = await tool('set_page_expiry', { slug, when: '2d' });
  expect(Date.parse(expiry.expires_at as string)).toBeGreaterThan(Date.now() + 47 * 3600e3);

  expect(await tool('delete_page', { slug })).toMatchObject({ deleted: slug });
  expect((await tool('list_pages')).pages).toEqual([]);
}, 60_000);
