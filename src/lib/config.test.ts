/**
 * Wave 0 contract for ~/.droppage config (Plan 03 implements).
 * Expected exports from ./config.js:
 * - getDroppageConfigPath(): string
 * - createConfStorage(): { getItem, setItem, removeItem }
 * - Config schema rejects keys containing service_role
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConfStorage, getDroppageConfigPath, getDroppageDir } from './config.js';

let tempHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'droppage-home-'));
  vi.stubEnv('HOME', tempHome);
  vi.stubEnv('DROPPAGE_HOME', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

test('getDroppageConfigPath resolves under HOME/.droppage/config.json', () => {
  expect(getDroppageConfigPath()).toBe(join(homedir(), '.droppage', 'config.json'));
});

test('DROPPAGE_HOME moves the session folder; blank falls back to ~/.droppage', () => {
  vi.stubEnv('DROPPAGE_HOME', join(tempHome!, 'session'));
  expect(getDroppageConfigPath()).toBe(join(tempHome!, 'session', 'config.json'));

  const storage = createConfStorage();
  storage.setItem('droppage-home-key', 'value');
  expect(existsSync(join(tempHome!, 'session', 'config.json'))).toBe(true);
  expect(existsSync(join(tempHome!, '.droppage'))).toBe(false);
  expect(statSync(join(tempHome!, 'session', 'config.json')).mode & 0o777).toBe(0o600);

  vi.stubEnv('DROPPAGE_HOME', 'relative/dir');
  expect(getDroppageDir()).toBe(resolve('relative/dir'));

  vi.stubEnv('DROPPAGE_HOME', '  ');
  expect(getDroppageDir()).toBe(join(homedir(), '.droppage'));
});

test('createConfStorage round-trips a string key', () => {
  const storage = createConfStorage();
  const key = `droppage-w0-${Date.now()}`;
  storage.setItem(key, 'session-value');
  expect(storage.getItem(key)).toBe('session-value');
  storage.removeItem(key);
  expect(storage.getItem(key)).toBeNull();
});

test('config schema rejects keys containing service_role', async () => {
  const mod = await import('./config.js');
  const validate =
    'validateConfig' in mod && typeof mod.validateConfig === 'function'
      ? mod.validateConfig
      : 'assertSafeConfig' in mod && typeof mod.assertSafeConfig === 'function'
        ? mod.assertSafeConfig
        : null;
  expect(validate).toBeTypeOf('function');
  expect(() =>
    validate!({
      service_role: 'should-reject',
    }),
  ).toThrow(/service_role/i);
});

test('the test run never points at the real ~/.droppage', () => {
  vi.unstubAllEnvs();
  expect(process.env.DROPPAGE_HOME).toMatch(/droppage-test-/);
  expect(getDroppageDir()).not.toBe(join(homedir(), '.droppage'));
});
