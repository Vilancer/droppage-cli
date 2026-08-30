import type { Command } from 'commander';
import { login } from '../services/auth.js';

export function registerLogin(program: Command): void {
  program
    .command('login')
    .description('Authenticate with Supabase')
    .action(async () => {
      await login();
    });
}
