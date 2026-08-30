import { customAlphabet } from 'nanoid';

/** Tunable slug length for URL-safe ids (research Open Question #2). */
export const SLUG_LENGTH = 10;

const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

const generate = customAlphabet(alphabet, SLUG_LENGTH);

/** Returns a URL-safe slug of length SLUG_LENGTH. */
export function createSlug(): string {
  return generate();
}
