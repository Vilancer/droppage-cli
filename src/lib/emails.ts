import { z } from 'zod';

/** The one email check: login, --email, recipients, feedback contact and MCP input. */
export const emailSchema = z.email();

/**
 * Normalize (trim + lowercase), drop empties and dedupe, then validate every
 * address BEFORE any network call (D-07): one bad address rejects the whole list
 * by name, so no recipient is silently dropped and then locked out.
 */
export function cleanEmails(values: string[], emptyMessage = 'no email addresses given'): string[] {
  const cleaned = [...new Set(values.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!cleaned.length) throw new Error(emptyMessage);
  const invalid = cleaned.filter((e) => !emailSchema.safeParse(e).success);
  if (invalid.length) throw new Error(`invalid email address(es): ${invalid.join(', ')}`);
  return cleaned;
}
