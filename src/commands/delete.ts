import { confirm as confirmPrompt } from '@inquirer/prompts';
import type { Command } from 'commander';
import { buildShareUrl } from '../lib/share-url.js';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import { deletePage } from '../services/pages.js';

export function registerDelete(program: Command): void {
  program
    .command('delete')
    .description('Delete a published page')
    // D-07: single-slug destructive operation; bulk delete is out of v1.
    .argument('<slug>', 'slug of the page to delete')
    // D-07: deletion prompts by default; scripts must opt into bypassing it.
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (slug: string, options: { yes?: boolean }) => {
      let user;
      try {
        user = await requireAuth();
      } catch (err) {
        if (err instanceof AuthRequiredError) return;
        throw err;
      }
      if (!options.yes) {
        const ok = await confirmPrompt({
          message: `Delete ${slug} (${buildShareUrl(slug)})? This cannot be undone.`,
          default: false,
        });
        if (!ok) {
          console.error('droppage: delete aborted.');
          return;
        }
      }
      try {
        const result = await deletePage(slug, user);
        if (result.ok) {
          console.error(`droppage: deleted ${slug}; the link no longer works.`);
          return;
        }
        console.error(`droppage: ${result.message}`);
        process.exitCode = 1;
      } catch (err) {
        console.error(
          `droppage: delete failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });
}
