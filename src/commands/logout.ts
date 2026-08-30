import type { Command } from 'commander';
import { logout } from '../services/auth.js';

export function registerLogout(program: Command): void {
  program
    .command('logout')
    .description('Sign out and clear local credentials')
    .action(async () => {
      await logout();
    });
}
