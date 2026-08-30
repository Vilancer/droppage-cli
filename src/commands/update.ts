import type { Command } from 'commander';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import { updatePageHtml } from '../services/pages.js';

export function registerUpdate(program: Command): void {
  program
    .command('update')
    .description('Replace the HTML behind an existing page URL')
    .argument('<slug>', 'slug of the page to update')
    .argument('<file>', 'path to replacement .html file')
    .action(async (slug: string, file: string) => {
      let user;
      try {
        user = await requireAuth();
      } catch (err) {
        if (err instanceof AuthRequiredError) return;
        throw err;
      }

      try {
        console.error(`droppage: updating ${slug} from ${file}...`);
        const result = await updatePageHtml({ slug, file, user });
        console.error(`droppage: updated ${slug}`);
        process.stdout.write(result.url + '\n');
      } catch (err) {
        process.exitCode = 1;
        console.error(
          `droppage: update failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
}
