const UNITS: Record<string, number> = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 };

/**
 * When a page should expire, from `--expires`: a duration (`30m`, `12h`, `7d`,
 * `2w`) from now, or an ISO date/time. `never` clears it (returns null).
 * Throws a readable error for anything else or a time in the past.
 */
export function parseExpiry(value: string, now = Date.now()): Date | null {
  const raw = value.trim().toLowerCase();
  if (raw === 'never' || raw === 'none') return null;
  const match = /^(\d+)\s*([mhdw])$/.exec(raw);
  if (match) {
    const ms = Number(match[1]) * UNITS[match[2]];
    if (ms <= 0) throw new Error(`--expires must be in the future: ${value}`);
    return new Date(now + ms);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const date = new Date(value.trim());
    if (Number.isNaN(date.getTime())) throw new Error(`--expires: not a date: ${value}`);
    if (date.getTime() <= now) throw new Error(`--expires must be in the future: ${value}`);
    return date;
  }
  throw new Error(`--expires: use a duration like 30m, 12h, 7d or 2w, a date like 2026-12-31, or never`);
}
