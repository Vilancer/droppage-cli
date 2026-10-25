import { resolveShareBaseUrl } from '../lib/share-url.js';
import { createSupabaseClient } from '../lib/supabase.js';

export type FeedbackKind = 'idea' | 'bug' | 'review' | 'other';
export type FeedbackActor = 'human' | 'agent';

export type SubmitFeedbackInput = {
  message: string;
  kind: FeedbackKind;
  actor: FeedbackActor;
  model?: string;
  contact?: string;
  rating?: number;
  testimonial_consent?: boolean;
  source: 'cli' | 'mcp';
  cli_version: string;
};

export class FeedbackRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'FeedbackRequestError';
  }
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<{ ok: true; id: string }> {
  const { data } = await createSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  const base = resolveShareBaseUrl();

  let response: Response;
  try {
    response = await fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw new FeedbackRequestError(
      `could not reach ${base}: ${error instanceof Error ? error.message : String(error)}`,
      0,
    );
  }

  const text = await response.text();
  let body: { ok?: boolean; id?: string; error?: string } | null = null;
  try { body = text ? JSON.parse(text) as typeof body : null; } catch { /* proxy error page */ }
  if (!response.ok || !body?.ok || !body.id) {
    throw new FeedbackRequestError(
      body?.error ?? `request failed (HTTP ${response.status})`,
      response.status,
    );
  }
  return { ok: true, id: body.id };
}
