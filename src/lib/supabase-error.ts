/**
 * supabase-js reports PostgREST/RPC failures as PLAIN objects
 * (`{ code, details, hint, message }`) rather than Error instances. Commands
 * render a failure with `err instanceof Error ? err.message : String(err)`, so
 * throwing one raw prints "[object Object]" and the server's own wording — the
 * quota and plan messages Postgres raises — never reaches the publisher.
 *
 * Normalize at the service boundary so the message survives, preserving `code`
 * for callers that branch on it.
 */
export function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (
    err !== null &&
    typeof err === 'object' &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    const error = new Error((err as { message: string }).message);
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') Object.assign(error, { code });
    return error;
  }
  return new Error(String(err));
}
