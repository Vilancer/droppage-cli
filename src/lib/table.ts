import type { AccessMode, PageRow } from '../services/pages.js';

export type TableAlign = 'left' | 'right';

export const PAGE_TABLE_HEADERS = [
  'SLUG',
  'MODE',
  'CREATED',
  'VIEWS',
  'LAST VIEWED',
] as const;

export const PAGE_TABLE_ALIGN = [
  'left',
  'left',
  'left',
  'right',
  'left',
] as const;

export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly TableAlign[] = headers.map(() => 'left'),
): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const formatRow = (row: readonly string[]) =>
    row
      .map((cell, i) =>
        align[i] === 'right'
          ? cell.padStart(widths[i])
          : cell.padEnd(widths[i]),
      )
      .join('  ')
      .trimEnd();
  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
}

export function formatModeCell(
  accessMode: AccessMode,
  allowedEmails: string[] | null,
): string {
  if (accessMode === 'email' || accessMode === 'private') {
    return `${accessMode}(${allowedEmails?.length ?? 0})`;
  }
  return accessMode;
}

export function formatDateCell(iso: string | null): string {
  // NULL means never viewed. Slicing keeps output deterministic and truncates
  // the UTC timestamp only for the table; JSON keeps full precision.
  return iso === null ? '—' : iso.slice(0, 10);
}

export function pageTableCells(row: PageRow): string[] {
  return [
    row.slug,
    formatModeCell(row.access_mode, row.allowed_emails),
    formatDateCell(row.created_at),
    String(row.view_count),
    formatDateCell(row.last_viewed_at),
  ];
}
