import type { Command } from 'commander';

import { renderTable } from '../lib/table.js';
import { AuthRequiredError, requireAuth } from '../services/auth.js';
import { fetchQuota, type QuotaUsage } from '../services/quota.js';

function formatBytes(value: number): string {
  if (value < 1_000_000) return `${Math.round(value / 1000)} KB`;
  if (value < 1_000_000_000) return `${Number((value / 1_000_000).toFixed(1))} MB`;
  return `${Number((value / 1_000_000_000).toFixed(2))} GB`;
}

function usedAndLimit(usage: QuotaUsage): string {
  const used = usage.meter === 'views' ? `${usage.used} views` : formatBytes(usage.used);
  if (usage.limit === null) return `${used} / unlimited`;
  const limit = usage.meter === 'views' ? `${usage.limit} views` : formatBytes(usage.limit);
  return `${used} / ${limit} (${usage.percent}%)`;
}

export function registerQuota(program: Command): void {
  program
    .command('quota')
    .description('Show your plan, current usage, and publishing limits')
    .option('--json', 'print the account API response as JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        await requireAuth();
      } catch (err) {
        if (err instanceof AuthRequiredError) return;
        throw err;
      }
      try {
        const result = await fetchQuota();
        if (options.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return;
        }

        const enabled = [
          result.entitlements.can_update && 'update',
          result.entitlements.can_preview && 'preview',
          result.entitlements.can_password && 'password',
          result.entitlements.can_email_allowlist && 'email',
        ].filter((feature): feature is string => Boolean(feature));
        const pageLimit = result.usage.pages.limit === null
          ? 'unlimited'
          : String(result.usage.pages.limit);
        process.stdout.write(renderTable(
          ['ITEM', 'VALUE'],
          [
            ['Plan', result.entitlements.plan_name],
            ['Pages', `${result.usage.pages.used} / ${pageLimit}`],
            ...(result.usage.images
              ? [['Images per page', result.usage.images.per_page_limit_bytes === null
                ? 'unlimited'
                : `up to ${formatBytes(result.usage.images.per_page_limit_bytes)}`]]
              : []),
            ['Monthly meter', usedAndLimit(result.usage)],
            ['Period ends', result.usage.period_end],
            ['Features', enabled.length ? enabled.join(', ') : 'basic publishing'],
          ],
        ) + '\n');
        console.error(`droppage: quota level ${result.usage.level}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`droppage: quota failed: ${message}`);
        process.exitCode = 1;
      }
    });
}
