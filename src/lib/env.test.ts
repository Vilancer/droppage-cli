/**
 * Wave 0 contract for Supabase env resolution (Plan 03 implements).
 * Expected export from ./env.js: resolveSupabaseEnv (or loadSupabaseEnv)
 */
import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSupabaseEnv } from './env.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();
let tempDir: string | undefined;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.chdir(ORIGINAL_CWD);
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  vi.restoreAllMocks();
});

test('DROPPAGE_SUPABASE_URL wins over SUPABASE_URL', () => {
  process.env.DROPPAGE_SUPABASE_URL = 'https://droppage.example';
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.DROPPAGE_SUPABASE_ANON_KEY = 'anon-droppage';
  delete process.env.SUPABASE_ANON_KEY;

  const env = resolveSupabaseEnv();
  expect(env.url).toBe('https://droppage.example');
});

test('cwd .env loads when process env is unset', () => {
  delete process.env.DROPPAGE_SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.DROPPAGE_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_ANON_KEY;

  tempDir = mkdtempSync(join(tmpdir(), 'droppage-env-'));
  writeFileSync(
    join(tempDir, '.env'),
    'DROPPAGE_SUPABASE_URL=https://from-dotenv.example\nDROPPAGE_SUPABASE_ANON_KEY=anon-from-dotenv\n',
  );
  process.chdir(tempDir);

  const env = resolveSupabaseEnv();
  expect(env.url).toBe('https://from-dotenv.example');
  expect(env.anonKey).toBe('anon-from-dotenv');
});

test('service_role values are rejected', () => {
  process.env.DROPPAGE_SUPABASE_URL = 'https://droppage.example';
  process.env.DROPPAGE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role.payload';

  expect(() => resolveSupabaseEnv()).toThrow(/service_role|secret/i);
});

test('sb_secret values are rejected', () => {
  process.env.DROPPAGE_SUPABASE_URL = 'https://droppage.example';
  process.env.DROPPAGE_SUPABASE_ANON_KEY = 'sb_secret_should_not_be_used';

  expect(() => resolveSupabaseEnv()).toThrow(/sb_secret|secret|service_role/i);
});

// dotenv writes its own banner ("◇ injected env (N) from .env // tip: …") to
// STDOUT via console.log unless `quiet` is set, which would corrupt the
// machine-readable stdout contract: upload/update print only the URL, `list
// --json` / `quota --json` only JSON, `feedback` only the submission id. The
// banner fires whether or not a .env file exists, so both cases are covered.
test.for([
  { label: 'with a .env present', writeDotenv: true },
  { label: 'with no .env at all', writeDotenv: false },
])('resolveSupabaseEnv writes nothing to stdout $label', ({ writeDotenv }) => {
  process.env.DROPPAGE_SUPABASE_URL = 'https://droppage.example';
  process.env.DROPPAGE_SUPABASE_ANON_KEY = 'anon-droppage';

  tempDir = mkdtempSync(join(tmpdir(), 'droppage-env-'));
  if (writeDotenv) {
    writeFileSync(join(tempDir, '.env'), 'UNRELATED_KEY=value\n');
  }
  process.chdir(tempDir);

  // dotenv logs through console.log, which can bypass a process.stdout.write
  // spy — watch both.
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  resolveSupabaseEnv();

  expect(logSpy).not.toHaveBeenCalled();
  expect(outSpy).not.toHaveBeenCalled();
});

test('DROPPAGE_HOME is ignored in ./.env and kept from the real environment', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'droppage-env-'));
  writeFileSync(join(tempDir, '.env'), 'DROPPAGE_HOME=./session\n');
  process.chdir(tempDir);

  delete process.env.DROPPAGE_HOME;
  resolveSupabaseEnv();
  expect(process.env.DROPPAGE_HOME).toBeUndefined();

  process.env.DROPPAGE_HOME = '/tmp/my-droppage';
  resolveSupabaseEnv();
  expect(process.env.DROPPAGE_HOME).toBe('/tmp/my-droppage');
});
