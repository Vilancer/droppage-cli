import { expect, test } from 'vitest';
import { formatBytes } from './image.js';

test('image sizes and budgets read like the plans (decimal units)', () => {
  expect(formatBytes(70)).toBe('70 B');
  expect(formatBytes(17742)).toBe('18 KB');
  expect(formatBytes(5_000_000)).toBe('5 MB');
  expect(formatBytes(20_000_000)).toBe('20 MB');
  expect(formatBytes(50_000_000)).toBe('50 MB');
  expect(formatBytes(3_500_000)).toBe('3.5 MB');
});
