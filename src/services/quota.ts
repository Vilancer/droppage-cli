import { resolveShareBaseUrl } from '../lib/share-url.js';
import { createSupabaseClient } from '../lib/supabase.js';

export type QuotaUsage = {
  meter: 'views' | 'bandwidth';
  used: number;
  limit: number | null;
  percent: number;
  level: 'normal' | 'warn' | 'limit';
  period_start: string;
  period_end: string;
  pages: { used: number; limit: number | null };
  /** Each page's image budget (absent from older servers). */
  images?: { per_page_limit_bytes: number | null };
};

export type QuotaResponse = {
  account: { user_id: string; email?: string; is_admin: boolean };
  subscription: Record<string, unknown> | null;
  entitlements: {
    plan_code: string;
    plan_name: string;
    can_update: boolean;
    can_preview: boolean;
    can_password: boolean;
    can_email_allowlist: boolean;
    [key: string]: unknown;
  };
  usage: QuotaUsage;
};

export class QuotaRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'QuotaRequestError';
  }
}

export async function fetchQuota(): Promise<QuotaResponse> {
  const supabase = createSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new QuotaRequestError('not signed in; run `droppage login`', 401);

  let response: Response;
  try {
    response = await fetch(`${resolveShareBaseUrl()}/api/account`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new QuotaRequestError(
      `could not reach ${resolveShareBaseUrl()}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A proxy can return HTML; retain the useful HTTP status below.
  }
  if (!response.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `request failed (HTTP ${response.status})`;
    throw new QuotaRequestError(message, response.status);
  }
  if (
    body === null ||
    typeof body !== 'object' ||
    !('usage' in body) ||
    !('entitlements' in body) ||
    typeof (body as { usage: unknown }).usage !== 'object' ||
    (body as { usage: unknown }).usage === null ||
    typeof (body as { entitlements: unknown }).entitlements !== 'object' ||
    (body as { entitlements: unknown }).entitlements === null
  ) {
    throw new QuotaRequestError(`request failed (HTTP ${response.status})`, response.status);
  }
  return body as QuotaResponse;
}
