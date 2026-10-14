import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const get = vi.fn();
const set = vi.fn();
vi.mock('./config.js', () => ({
  getUpdateCheckConf: () => ({ get, set }),
}));

let originalTty: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-31T12:00:00.000Z'));
  originalTty = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  delete process.env.CI;
  delete process.env.DROPPAGE_NO_UPDATE_CHECK;
  get.mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.CI;
  delete process.env.DROPPAGE_NO_UPDATE_CHECK;
  if (originalTty) Object.defineProperty(process.stderr, 'isTTY', originalTty);
});

test('a stale cache fetches latest, stores it, and writes notice to stderr only', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ version: '9.9.9' })));
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const { checkForUpdate } = await import('./update-check.js');
  await checkForUpdate();
  expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/droppage/latest', expect.objectContaining({
    signal: expect.any(AbortSignal),
  }));
  expect(set).toHaveBeenCalledWith('latest', '9.9.9');
  expect(set).toHaveBeenCalledWith('lastCheckedAt', '2026-08-31T12:00:00.000Z');
  expect(stderr.mock.calls.flat().join('')).toContain('droppage upgrade');
  expect(stdout).not.toHaveBeenCalled();
});

test('a fresh cache avoids fetch but still shows its cached notice', async () => {
  get.mockImplementation((key: string) => key === 'lastCheckedAt'
    ? '2026-08-31T11:00:00.000Z'
    : '9.9.9');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const { checkForUpdate } = await import('./update-check.js');
  await checkForUpdate();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(stderr).toHaveBeenCalled();
});

test('a cached older version never advertises a downgrade', async () => {
  get.mockImplementation((key: string) => key === 'lastCheckedAt'
    ? '2026-08-31T11:00:00.000Z'
    : '0.1.0');
  vi.stubGlobal('fetch', vi.fn());
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const { checkForUpdate } = await import('./update-check.js');
  await checkForUpdate();
  expect(stderr).not.toHaveBeenCalled();
});

test.each([
  ['not a TTY', () => Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true })],
  ['CI', () => { process.env.CI = '1'; }],
  ['opt out', () => { process.env.DROPPAGE_NO_UPDATE_CHECK = '1'; }],
])('%s gates the check before config or network access', async (_label, gate) => {
  gate();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const { checkForUpdate } = await import('./update-check.js');
  await checkForUpdate();
  expect(get).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(stderr).not.toHaveBeenCalled();
});

test('network failures are swallowed without touching either stream', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const { checkForUpdate } = await import('./update-check.js');
  await expect(checkForUpdate()).resolves.toBeUndefined();
  expect(stderr).not.toHaveBeenCalled();
  expect(stdout).not.toHaveBeenCalled();
});
