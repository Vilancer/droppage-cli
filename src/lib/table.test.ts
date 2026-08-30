import { expect, test } from 'vitest';
import { formatModeCell, pageTableCells, renderTable } from './table.js';
import type { PageRow } from '../services/pages.js';

test('renderTable right-aligns numeric columns and left-aligns text without truncation', () => {
  const headers = ['SLUG', 'VIEWS'];
  const rows = [
    ['a-very-long-slug-name', '3'],
    ['x', '12000'],
  ];
  const out = renderTable(headers, rows, ['left', 'right']);
  const lines = out.split('\n');

  // No truncation: the long slug must appear in full, not cut short.
  expect(lines[1]).toContain('a-very-long-slug-name');

  // Right-aligned numeric column: the VIEWS values line up on their right edge.
  const viewsColStart = lines[0].indexOf('VIEWS');
  const row1End = lines[1].indexOf('3') + 1;
  const row2End = lines[2].indexOf('12000') + 5;
  // '12000' is wider than '3' + padding, so header and both rows should end
  // at the exact same column index for the VIEWS field.
  expect(row1End).toBe(viewsColStart + 'VIEWS'.length);
  expect(row2End).toBe(viewsColStart + 'VIEWS'.length);
});

test('formatModeCell shows recipient counts for email/private but not public/password', () => {
  expect(formatModeCell('email', ['a@x.com', 'b@x.com', 'c@x.com'])).toBe(
    'email(3)',
  );
  expect(formatModeCell('private', ['only@x.com'])).toBe('private(1)');
  expect(formatModeCell('public', null)).toBe('public');
  expect(formatModeCell('password', null)).toBe('password');
});

test('pageTableCells maps a PageRow into the exact column order used by list', () => {
  const row: PageRow = {
    slug: 'abc123',
    access_mode: 'email',
    allowed_emails: ['a@x.com', 'b@x.com'],
    view_count: 42,
    created_at: '2026-08-01T10:00:00.000Z',
    last_viewed_at: null,
  };
  expect(pageTableCells(row)).toEqual([
    'abc123',
    'email(2)',
    '2026-08-01',
    '42',
    '—',
  ]);
});
