import { expect, test } from 'vitest';
import { validateHtmlUpload } from './validate-html.js';

test('throws on a non-.html/.htm extension', () => {
  expect(() =>
    validateHtmlUpload('x.pdf', Buffer.from('<!doctype html>')),
  ).toThrow(/\.html|\.htm/i);
});

test('throws on an empty file', () => {
  expect(() => validateHtmlUpload('x.html', Buffer.alloc(0))).toThrow(
    /empty/i,
  );
});

test('throws when the file exceeds the 5MB size cap', () => {
  const tooBig = Buffer.alloc(6 * 1024 * 1024, 0x20); // 6MB of spaces
  expect(() => validateHtmlUpload('x.html', tooBig)).toThrow(/5\s?MB|too large|size/i);
});

test('throws when the content does not look like HTML (renamed PDF)', () => {
  const pdf = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj');
  expect(() => validateHtmlUpload('x.html', pdf)).toThrow(/html/i);
});

test('accepts valid HTML (.htm) with no warnings', () => {
  const res = validateHtmlUpload(
    'x.htm',
    Buffer.from('<!doctype html><html><body><h1>hi</h1></body></html>'),
  );
  expect(res).toEqual({ ok: true, warnings: [] });
});

test('accepts a bare <body> fragment via the content sniff', () => {
  const res = validateHtmlUpload(
    'x.html',
    Buffer.from('<body><div>report</div></body>'),
  );
  expect(res.ok).toBe(true);
  expect(res.warnings).toEqual([]);
});

test('warns (non-fatal) on a relative asset reference', () => {
  const res = validateHtmlUpload(
    'x.html',
    Buffer.from(
      '<!doctype html><html><body><script src="./a.js"></script></body></html>',
    ),
  );
  expect(res.ok).toBe(true);
  expect(res.warnings.length).toBeGreaterThan(0);
  expect(res.warnings.join('\n')).toMatch(/asset|resolve|relative/i);
});

test('warns on a root-relative href', () => {
  const res = validateHtmlUpload(
    'x.html',
    Buffer.from(
      '<!doctype html><html><head><link href="/styles.css" rel="stylesheet"></head><body>x</body></html>',
    ),
  );
  expect(res.warnings.length).toBeGreaterThan(0);
});

test('extension check is case-insensitive', () => {
  const res = validateHtmlUpload(
    'REPORT.HTML',
    Buffer.from('<!doctype html><body>ok</body>'),
  );
  expect(res.ok).toBe(true);
});
