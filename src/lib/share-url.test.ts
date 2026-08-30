import { afterEach, expect, test } from 'vitest';
import { createSlug } from './slug.js';
import {
  DEFAULT_SHARE_BASE_URL,
  buildShareUrl,
  resolveShareBaseUrl,
} from './share-url.js';

afterEach(() => {
  delete process.env.DROPPAGE_SHARE_BASE_URL;
});

test('DEFAULT_SHARE_BASE_URL is the production droppage.dev origin', () => {
  expect(DEFAULT_SHARE_BASE_URL).toBe('https://droppage.dev');
});

test('buildShareUrl defaults to the production droppage.dev URL for a sample slug', () => {
  expect(buildShareUrl('abc123XYZ_')).toBe('https://droppage.dev/p/abc123XYZ_');
});

test('DROPPAGE_SHARE_BASE_URL overrides the production default for dev/test/staging', () => {
  process.env.DROPPAGE_SHARE_BASE_URL = 'https://pages.example.com';

  expect(resolveShareBaseUrl()).toBe('https://pages.example.com');
  expect(buildShareUrl('abc123XYZ_')).toBe(
    'https://pages.example.com/p/abc123XYZ_',
  );
});

test('DROPPAGE_SHARE_BASE_URL trims trailing slashes before appending the page path', () => {
  process.env.DROPPAGE_SHARE_BASE_URL = 'https://pages.example.com///';

  expect(buildShareUrl('abc123XYZ_')).toBe(
    'https://pages.example.com/p/abc123XYZ_',
  );
});

test('buildShareUrl preserves the fixed slug alphabet byte-for-byte', () => {
  const slug = createSlug();
  // slug is drawn only from the URL-safe alphabet; the URL must not alter it.
  expect(/^[A-Za-z0-9_-]{10}$/.test(slug)).toBe(true);
  const url = buildShareUrl(slug);
  expect(url).toBe(`https://droppage.dev/p/${slug}`);
  expect(url.slice('https://droppage.dev/p/'.length)).toBe(slug);
});
