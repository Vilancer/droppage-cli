import { expect, test } from 'vitest';
import { asError } from './supabase-error.js';

test('converts a plain PostgREST error object into a real Error', () => {
  const error = asError({
    code: 'P0001',
    details: null,
    hint: null,
    message: 'page quota reached (5 of 5); delete a page or upgrade',
  });

  expect(error).toBeInstanceOf(Error);
  // The regression this guards: `String(plainObject)` is "[object Object]", so
  // the server's wording (and the quota hint keyed off it) was lost.
  expect(error.message).toBe('page quota reached (5 of 5); delete a page or upgrade');
  expect(String(error)).toContain('page quota reached');
  expect(error).toMatchObject({ code: 'P0001' });
});

test('returns an existing Error untouched', () => {
  const original = new Error('bucket denied');
  expect(asError(original)).toBe(original);
});

test('falls back to string conversion for anything else', () => {
  expect(asError('boom').message).toBe('boom');
  expect(asError(null).message).toBe('null');
  expect(asError({ code: 'X' }).message).toBe('[object Object]');
});
