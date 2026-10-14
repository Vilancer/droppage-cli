import { spawn } from 'node:child_process';
import type { Command } from 'commander';

function installLatest(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '-g', 'droppage@latest'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`npm exited with status ${code ?? 'unknown'}`)));
  });
}

export function registerUpgrade(program: Command): void {
  program.command('upgrade').description('Install the latest droppage CLI release').action(async () => {
    try {
      await installLatest();
      // PATH in this process may still point at the pre-upgrade binary.
      console.error('droppage: upgrade complete; run `droppage --version` to confirm.');
    } catch (error) {
      console.error(`droppage: upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });
}
