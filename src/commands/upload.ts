import { password as passwordPrompt } from '@inquirer/prompts';
import type { Command } from 'commander';
import { hashPassword } from '../lib/password.js';
import { parseExpiry } from '../lib/duration.js';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import { publishPage, resolveAccess } from '../services/publish.js';
import type { AccessMode } from '../services/upload.js';

/** The one access mode the flags ask for; the command rejects more than one first (D-06). */
function accessModeOf(options: { password?: boolean; email?: string[]; private?: boolean }): AccessMode {
  if (options.password) return 'password';
  if (options.email?.length) return 'email';
  return options.private ? 'private' : 'public';
}

export function registerUpload(program: Command): void {
  program
    .command('upload')
    .description('Upload an HTML file and get a shareable URL')
    .argument('<file>', 'path to .html file')
    // D-04: boolean flag ONLY — the plaintext password is NEVER accepted as an
    // inline `--password <value>` (shell-history / argv leak). Prompted securely.
    .option('--password', 'protect the page with a password (prompts securely)')
    // ACC-02 / D-05: repeatable AND comma-splittable allowlist. Emails are not
    // secrets (unlike --password) so the value is accepted inline. The collector
    // concats each occurrence's comma-split; normalization/dedupe happens in the
    // action.
    .option(
      '--email <address>',
      'restrict access to an email allowlist (repeatable; comma-separated)',
      (val: string, prev: string[] = []) => prev.concat(val.split(',')),
    )
    // ACC-03 / D-04/D-06: boolean flag — owner-only draft. Self-allowlists the
    // authenticated user's own email; anonymous visitors are blocked.
    .option('--private', 'restrict access to only you (owner-only draft)')
    .option('--expires <when>', 'delete the page (and its images and videos) after 30m, 12h, 7d, 2w or on a date')
    .action(
      async (
        file: string,
        options: { password?: boolean; email?: string[]; private?: boolean; expires?: string },
      ) => {
        // Single auth gate (WR-04): resolve the publisher once here and thread the
        // user into upload(), rather than calling getUser() again in the service.
        let user;
        try {
          user = await requireAuth();
        } catch (err) {
          if (err instanceof AuthRequiredError) return;
          throw err;
        }

        // D-06: --password, --email, --private are mutually exclusive — a page is
        // exactly one access mode. More than one is a hard CLI error that exits
        // non-zero and makes NO network call (no password prompt, no upload()).
        const modeFlags = [
          options.password,
          options.email?.length,
          options.private,
        ].filter(Boolean).length;
        if (modeFlags > 1) {
          process.exitCode = 1;
          console.error(
            'droppage: --password, --email, and --private are mutually exclusive — a page is exactly one access mode.',
          );
          return;
        }

        try {
          let passwordHash: string | undefined;
          if (options.password) {
            // D-04: capture the password interactively (masked) AFTER auth. Both
            // the prompt and the mismatch error live on stderr (D-10); the
            // plaintext is never logged and never leaves this scope — only its
            // bcrypt hash does.
            const pw = await passwordPrompt({ message: 'Password:', mask: '*' });
            const confirm = await passwordPrompt({
              message: 'Confirm password:',
              mask: '*',
            });
            if (pw !== confirm) throw new Error('Passwords do not match');
            passwordHash = await hashPassword(pw);
          }
          // Validates every --email address (D-07) and resolves --private to the
          // owner's own email (D-04), all before any network call.
          const access = resolveAccess(
            user,
            accessModeOf(options),
            { emails: options.email, passwordHash },
          );

          // D-10: all status/progress goes to stderr; stdout stays URL-only.
          const expiresAt = options.expires ? parseExpiry(options.expires) ?? undefined : undefined;
          console.error(`droppage: uploading ${file}...`);
          // Local <img src="chart.png"> files are uploaded to the page and the
          // links rewritten, once the page's slug is chosen.
          const { url } = await publishPage({ file, user, access, expiresAt });
          if (expiresAt) console.error(`droppage: expires ${expiresAt.toISOString()}`);
          console.error('droppage: done');
          // stdout carries ONLY the bare URL — pipe-friendly for agents/CI.
          process.stdout.write(url + '\n');
        } catch (err) {
          process.exitCode = 1;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`droppage: upload failed: ${message}`);
          if (/quota reached|require (Starter|Builder)/i.test(message)) {
            console.error('run `droppage quota` to see your limits');
          }
        }
      },
    );
}
