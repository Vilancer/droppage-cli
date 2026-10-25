import type { User } from '@supabase/supabase-js';
import { resolveShareBaseUrl } from '../lib/share-url.js';
import { createSupabaseClient } from '../lib/supabase.js';

/**
 * Recipient management (Phase 7 / RECIP-01..05).
 *
 * Every call goes through the serve tier rather than straight to Postgres. That
 * is not indirection for its own sake: adding a recipient must ALSO queue and
 * dispatch an invitation, and the pieces that need — RESEND_API_KEY and
 * RECIPIENT_TOKEN_SECRET — are serve-only by ARCH-02 and must never reach the
 * CLI. The serve route runs the same owner-scoped RPCs under the caller's JWT,
 * so ownership and plan limits are still enforced in the database.
 */

export type RecipientStatus = 'active' | 'revoked';
export type InvitationStatus = 'pending' | 'queued' | 'sent' | 'failed';

export type RecipientRow = {
  id: string;
  email: string;
  status: RecipientStatus;
  invitation_status: InvitationStatus;
  last_sent_at: string | null;
  created_at: string;
};

export type RecipientListResult = {
  slug: string;
  page: number;
  page_size: number;
  total: number;
  recipients: RecipientRow[];
};

export type InviteResult = {
  slug: string;
  queued: number;
  invited: string[];
};

export type AddRecipientsResult = {
  slug: string;
  queued: number;
  unchanged: number;
  recipients: { email: string; recipient_id: string; was_new: boolean }[];
};

/** Raised for a non-2xx serve response, carrying the server's own message. */
export class RecipientRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RecipientRequestError';
  }
}

async function authedFetch(
  path: string,
  init: RequestInit & { method: string },
): Promise<unknown> {
  const supabase = createSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RecipientRequestError('not signed in; run `droppage login`', 401);

  let response: Response;
  try {
    response = await fetch(`${resolveShareBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    // A dead/unreachable serve tier is a connectivity problem, not a user error.
    throw new RecipientRequestError(
      `could not reach ${resolveShareBaseUrl()}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error page (proxy/CDN); fall through to the status-based message.
  }
  if (!response.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `request failed (HTTP ${response.status})`;
    throw new RecipientRequestError(message, response.status);
  }
  return body;
}

function recipientsPath(slug: string): string {
  return `/api/pages/${encodeURIComponent(slug)}/recipients`;
}

export async function listRecipients(
  slug: string,
  _user: User,
  page = 1,
): Promise<RecipientListResult> {
  return (await authedFetch(`${recipientsPath(slug)}?page=${page}`, {
    method: 'GET',
  })) as RecipientListResult;
}

export async function addRecipients(
  slug: string,
  emails: string[],
  _user: User,
): Promise<AddRecipientsResult> {
  return (await authedFetch(recipientsPath(slug), {
    method: 'POST',
    body: JSON.stringify({ emails }),
  })) as AddRecipientsResult;
}

/**
 * Email an invitation to everyone on an email page who has not had one yet.
 * Publishing only lists the addresses; this is the step that mails them. Safe to
 * repeat: people already invited are skipped (use `resendRecipient` for them).
 */
export async function inviteRecipients(slug: string): Promise<InviteResult> {
  return (await authedFetch(recipientsPath(slug), {
    method: 'POST',
    body: JSON.stringify({ action: 'invite' }),
  })) as InviteResult;
}

export async function removeRecipient(
  slug: string,
  email: string,
  _user: User,
): Promise<void> {
  await authedFetch(`${recipientsPath(slug)}?email=${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
}

export async function resendRecipient(
  slug: string,
  email: string,
  _user: User,
): Promise<void> {
  await authedFetch(recipientsPath(slug), {
    method: 'POST',
    body: JSON.stringify({ action: 'resend', email }),
  });
}
