import { expect, test } from 'vitest';
import { createSlug } from './slug.js';

test('createSlug returns a URL-safe string', () => {
  const slug = createSlug();
  expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
});

test('createSlug returns length exactly 10', () => {
  const slug = createSlug();
  expect(slug).toHaveLength(10);
});

test('consecutive createSlug calls are not equal', () => {
  const a = createSlug();
  const b = createSlug();
  expect(a).not.toEqual(b);
});
