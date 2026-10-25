import { afterEach, expect, test, vi } from 'vitest';

import { collectNotices, notify } from './notify.js';

afterEach(() => vi.restoreAllMocks());

test('outside a collector, notices are droppage: stderr lines and stdout stays clean', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const out = vi.spyOn(process.stdout, 'write');
  notify('info', 'image a.png → https://droppage.dev/i/x.png');
  notify('warning', 'careful');
  notify('tip', 'use WebP');
  expect(err.mock.calls.map((c) => c[0])).toEqual([
    'droppage: image a.png → https://droppage.dev/i/x.png',
    'droppage: warning: careful',
    'droppage: tip: use WebP',
  ]);
  expect(out).not.toHaveBeenCalled();
});

test('inside a collector, notices are collected instead of printed', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { result, notices } = await collectNotices(async () => {
    notify('warning', 'careful');
    await Promise.resolve();
    notify('tip', 'use WebP');
    return 42;
  });
  expect(result).toBe(42);
  expect(notices).toEqual([{ level: 'warning', message: 'careful' }, { level: 'tip', message: 'use WebP' }]);
  expect(err).not.toHaveBeenCalled();
});
