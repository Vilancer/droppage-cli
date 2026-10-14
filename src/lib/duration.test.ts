import { expect, test } from 'vitest';
import { parseExpiry } from './duration.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');

test('durations count from now', () => {
  expect(parseExpiry('30m', NOW)?.toISOString()).toBe('2026-10-14T12:30:00.000Z');
  expect(parseExpiry('12h', NOW)?.toISOString()).toBe('2026-10-15T00:00:00.000Z');
  expect(parseExpiry('7d', NOW)?.toISOString()).toBe('2026-10-21T12:00:00.000Z');
  expect(parseExpiry('2w', NOW)?.toISOString()).toBe('2026-10-28T12:00:00.000Z');
});

test('dates, never, and mistakes', () => {
  expect(parseExpiry('2026-12-31', NOW)?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  expect(parseExpiry('never', NOW)).toBeNull();
  expect(() => parseExpiry('2020-01-01', NOW)).toThrow(/future/);
  expect(() => parseExpiry('0d', NOW)).toThrow(/future/);
  expect(() => parseExpiry('soon', NOW)).toThrow(/30m, 12h, 7d or 2w/);
});
