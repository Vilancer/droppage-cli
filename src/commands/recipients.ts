import { confirm as confirmPrompt } from '@inquirer/prompts';
import type { Command } from 'commander';
import { z } from 'zod';
import { renderTable } from '../lib/table.js';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import {
  addRecipients,
  listRecipients,
  removeRecipient,
  RecipientRequestError,
  resendRecipient,
  type RecipientRow,
} from '../services/recipients.js';

const emailSchema = z.email();

const RECIPIENT_HEADERS = ['EMAIL', 'STATUS', 'INVITATION', 'LAST SENT'] as const;
const RECIPIENT_ALIGN = ['left', 'left', 'left', 'left'] as const;

function formatDateCell(iso: string | null): string {
  return iso === null ? '—' : iso.slice(0, 10);
}

function recipientCells(row: RecipientRow): string[] {
  return [row.email, row.status, row.invitation_status, formatDateCell(row.last_sent_at)];
}

/**
 * Normalize + validate a list of addresses BEFORE any network call, mirroring the
 * upload command's contract (D-07): one bad address rejects the whole batch by
 * name, so no recipient is silently dropped and then left without access.
 */
function cleanEmails(values: string[]): string[] {
  const cleaned = [...new Set(values.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!cleaned.length) throw new Error('no email addresses given');
  const invalid = cleaned.filter((e) => !emailSchema.safeParse(e).success);
  if (invalid.length) throw new Error(`invalid email address(es): ${invalid.join(', ')}`);
  return cleaned;
}

/** Shared auth + error envelope. Status goes to stderr; stdout stays parseable. */
async function run(action: (user: Awaited<ReturnType<typeof requireAuth>>) => Promise<void>) {
  let user;
  try {
    user = await requireAuth();
  } catch (err) {
    if (err instanceof AuthRequiredError) return;
    throw err;
  }
  try {
    await action(user);
  } catch (err) {
    const message =
      err instanceof RecipientRequestError || err instanceof Error
        ? err.message
        : String(err);
    console.error(`droppage: ${message}`);
    process.exitCode = 1;
  }
}

export function registerRecipients(program: Command): void {
  const recipients = program
    .command('recipients')
    .description('Manage who can open an email-gated page');

  recipients
    .command('list')
    .description('List recipients on a page')
    .argument('<slug>', 'slug of the page')
    .option('--json', 'print a machine-readable JSON object')
    .option('--page <n>', 'page number for paginated results', '1')
    .action(async (slug: string, options: { json?: boolean; page?: string }) => {
      await run(async (user) => {
        const page = Number(options.page);
        const result = await listRecipients(
          slug,
          user,
          Number.isSafeInteger(page) && page > 0 ? page : 1,
        );
        if (options.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return;
        }
        if (result.recipients.length === 0) {
          console.error(`droppage: no recipients on ${slug} yet.`);
          return;
        }
        process.stdout.write(
          renderTable(
            RECIPIENT_HEADERS,
            result.recipients.map(recipientCells),
            RECIPIENT_ALIGN,
          ) + '\n',
        );
        const shown = result.recipients.length;
        console.error(
          `droppage: ${shown} of ${result.total} recipient(s), page ${result.page}.`,
        );
      });
    });

  recipients
    .command('add')
    .description('Add recipients and queue their invitations')
    .argument('<slug>', 'slug of the page')
    .argument('<emails...>', 'one or more email addresses')
    .action(async (slug: string, emails: string[]) => {
      await run(async (user) => {
        const cleaned = cleanEmails(emails);
        const result = await addRecipients(slug, cleaned, user);
        // "Queued", not "sent" — delivery happens in the background after the
        // request returns (RECIP-02). Check `recipients list` for the outcome.
        console.error(
          `droppage: ${result.queued} invitation(s) queued, ${result.unchanged} already had access.`,
        );
      });
    });

  recipients
    .command('remove')
    .description('Revoke a recipient; their invitation link stops working')
    .argument('<slug>', 'slug of the page')
    .argument('<email>', 'email address to revoke')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (slug: string, email: string, options: { yes?: boolean }) => {
      await run(async (user) => {
        const [cleaned] = cleanEmails([email]);
        if (!options.yes) {
          const ok = await confirmPrompt({
            message: `Revoke ${cleaned} from ${slug}? Their link will stop working.`,
            default: false,
          });
          if (!ok) {
            console.error('droppage: remove aborted.');
            return;
          }
        }
        await removeRecipient(slug, cleaned, user);
        console.error(`droppage: revoked ${cleaned}; their link no longer works.`);
      });
    });

  recipients
    .command('resend')
    .description('Queue a fresh invitation for one existing recipient')
    .argument('<slug>', 'slug of the page')
    .argument('<email>', 'email address to resend to')
    .action(async (slug: string, email: string) => {
      await run(async (user) => {
        const [cleaned] = cleanEmails([email]);
        await resendRecipient(slug, cleaned, user);
        console.error(`droppage: invitation for ${cleaned} queued.`);
      });
    });
}
