import { password as passwordPrompt } from '@inquirer/prompts';
import type { Command } from 'commander';
import { hashPassword } from '../lib/password.js';
import { AuthRequiredError, emailSchema, requireAuth } from '../services/auth.js';
import { type AccessMode, upload } from '../services/upload.js';

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
    .action(
      async (
        file: string,
        options: { password?: boolean; email?: string[]; private?: boolean },
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
          let allowedEmails: string[] | undefined;
          let accessMode: AccessMode = 'public';

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
            accessMode = 'password';
          } else if (options.email?.length) {
            // ACC-02 / D-05: normalize (trim + lowercase), drop empties, and dedupe
            // so the serve-side membership check is a direct comparison (Pitfall 4).
            const cleaned = [
              ...new Set(
                options.email
                  .map((e) => e.trim().toLowerCase())
                  .filter(Boolean),
              ),
            ];
            // D-07: after dropping empties there must be at least one recipient —
            // an all-empty --email must NOT silently become a public upload.
            if (!cleaned.length) {
              throw new Error(
                '--email was given but contained no email addresses',
              );
            }
            // D-07: validate EVERY address with z.email() BEFORE any network call.
            // Any failure rejects the whole upload naming the bad value(s) — no
            // recipient is silently dropped and then locked out.
            const invalid = cleaned.filter(
              (e) => !emailSchema.safeParse(e).success,
            );
            if (invalid.length) {
              throw new Error(
                `invalid email address(es): ${invalid.join(', ')}`,
              );
            }
            allowedEmails = cleaned;
            accessMode = 'email';
          } else if (options.private) {
            // D-04: private = a one-address allowlist containing the owner's own
            // email, resolved from the authenticated user. The owner unlocks
            // through the identical magic-link path.
            const ownerEmail = user.email?.trim().toLowerCase();
            if (!ownerEmail) {
              throw new Error(
                '--private requires an email on your account, but none was found',
              );
            }
            allowedEmails = [ownerEmail];
            accessMode = 'private';
          }

          // D-10: all status/progress goes to stderr; stdout stays URL-only.
          console.error(`droppage: uploading ${file}...`);
          const url = await upload({
            file,
            user,
            passwordHash,
            allowedEmails,
            accessMode,
          });
          console.error('droppage: done');
          // stdout carries ONLY the bare URL — pipe-friendly for agents/CI.
          process.stdout.write(url + '\n');
        } catch (err) {
          process.exitCode = 1;
          console.error(
            `droppage: upload failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
}
