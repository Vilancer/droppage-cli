import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { registerLogin } from './commands/login.js';
import { registerLogout } from './commands/logout.js';
import { registerUpload } from './commands/upload.js';
import { registerUpdate } from './commands/update.js';
import { registerList } from './commands/list.js';
import { registerDelete } from './commands/delete.js';
import { registerRecipients } from './commands/recipients.js';
import { registerQuota } from './commands/quota.js';
import { registerFeedback } from './commands/feedback.js';
import { registerUpgrade } from './commands/upgrade.js';
import { registerImage } from './commands/image.js';
import { registerMcp } from './commands/mcp.js';
import { dashSlugHint } from './lib/slug.js';

export function createProgram(): Command {
  const program = new Command()
    .name('droppage')
    .description(
      'Publish HTML files as shareable, access-controlled live pages',
    )
    .version(pkg.version)
    // Set before the subcommands are registered: they copy these settings.
    .configureOutput({ outputError: (str, write) => write(str + dashSlugHint(str)) });

  registerLogin(program);
  registerLogout(program);
  registerUpload(program);
  registerUpdate(program);
  registerList(program);
  registerDelete(program);
  registerRecipients(program);
  registerQuota(program);
  registerImage(program);
  registerFeedback(program);
  registerUpgrade(program);
  registerMcp(program);

  return program;
}
