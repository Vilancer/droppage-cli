import { expect, test } from 'vitest';
import { createSlug, dashSlugHint } from './slug.js';

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

test('createSlug never starts with a dash (it would read as a CLI option)', () => {
  // With the old alphabet about 1 in 64 slugs started with `-`; 5,000 draws
  // would almost surely include one.
  for (let i = 0; i < 5000; i++) expect(createSlug()).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{9}$/);
});

test('dashSlugHint explains -- for a slug commander rejected as an option', () => {
  const hint = dashSlugHint("error: unknown option '-qLbzTOiZF'\n");
  expect(hint).toContain('droppage expire -- -qLbzTOiZF never');
  expect(hint).toContain('droppage update --expires 7d -- -qLbzTOiZF report.html');
  expect(hint.startsWith('droppage: if -qLbzTOiZF is a page')).toBe(true);
});

test('dashSlugHint stays quiet for real unknown options and other errors', () => {
  expect(dashSlugHint("error: unknown option '--expire'\n")).toBe('');
  expect(dashSlugHint("error: unknown option '-x'\n")).toBe('');
  expect(dashSlugHint("error: missing required argument 'slug'\n")).toBe('');
});
