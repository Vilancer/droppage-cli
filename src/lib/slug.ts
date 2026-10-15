import { customAlphabet } from 'nanoid';

/** Tunable slug length for URL-safe ids (research Open Question #2). */
export const SLUG_LENGTH = 10;

const alphanumeric =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const alphabet = `${alphanumeric}_-`;

// The first character is never `-`: a slug like `-qLbzTOiZF` reads as an
// option to the CLI (`droppage delete -qLbzTOiZF` fails with "unknown option").
const first = customAlphabet(alphanumeric, 1);
const rest = customAlphabet(alphabet, SLUG_LENGTH - 1);

/** Returns a URL-safe slug of length SLUG_LENGTH that never starts with `-`. */
export function createSlug(): string {
  return first() + rest();
}

const DASH_SLUG_ERROR = new RegExp(`unknown option '(-[A-Za-z0-9_][A-Za-z0-9_-]{${SLUG_LENGTH - 2}})'`);

/**
 * Hint for commander's "unknown option" error when the "option" is really a
 * page slug that starts with `-` (pages published before CLI 0.2.1). Returns
 * an empty string for any other error.
 */
export function dashSlugHint(error: string): string {
  const slug = DASH_SLUG_ERROR.exec(error)?.[1];
  if (!slug) return '';
  return (
    `droppage: if ${slug} is a page, put -- in front of it (options go before the --), for example:\n` +
    `  droppage expire -- ${slug} never\n` +
    `  droppage update --expires 7d -- ${slug} report.html\n`
  );
}
