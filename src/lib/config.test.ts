/**
 * Wave 0 contract for ~/.droppage config (Plan 03 implements).
 * Expected exports from ./config.js:
 * - getDroppageConfigPath(): string
 * - createConfStorage(): { getItem, setItem, removeItem }
 * - Config schema rejects keys containing service_role
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfStorage, getDroppageConfigPath } from './config.js';

let tempHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'droppage-home-'));
  vi.stubEnv('HOME', tempHome);
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
