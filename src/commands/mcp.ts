import type { Command } from 'commander';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createDroppageServer } from '../mcp/server.js';

export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description('Run a Model Context Protocol server on stdio, so AI agents publish through typed tools (sign in first with `droppage login`)')
    .action(() => {
      // stdout is the protocol from here on: anything else written there would
      // corrupt it, so console.log/info/debug go to stderr like everything human.
      console.log = console.info = console.debug = console.error;
      serveStdio(createDroppageServer);
    });
}
