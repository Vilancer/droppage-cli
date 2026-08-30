import type { Command } from 'commander';

const MIN_NODE_MAJOR = 22;
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MIN_NODE_MAJOR) {
  process.stderr.write(
    `droppage requires Node.js ${MIN_NODE_MAJOR} or newer (found ${process.versions.node}).\n` +
      'Upgrade Node.js: https://nodejs.org/\n',
  );
  process.exit(1);
}

const { createProgram } = await import('./index.js');
const program: Command = createProgram();
await program.parseAsync(process.argv);
