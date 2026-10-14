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

const page = (body: string) => Buffer.from(`<!doctype html><html><body>${body}</body></html>`);
const externalWarning = (body: string) =>
  validateHtmlUpload('r.html', page(body)).warnings.some((w) => w.includes('external assets'));

test('warns about external assets', () => {
  expect(externalWarning('<img src="https://cdn.example.com/a.png">')).toBe(true);
  expect(externalWarning('<script src="//cdn.example.com/x.js"></script>')).toBe(true);
});

test('does not warn about images hosted with droppage image upload', () => {
  delete process.env.DROPPAGE_SHARE_BASE_URL;
  expect(externalWarning('<img src="https://droppage.dev/i/AbCdEfGhIjKl.png">')).toBe(false);
  // …but still warns when anything else external is there too.
  expect(externalWarning('<img src="https://droppage.dev/i/AbCdEfGhIjKl.png"><img src="https://x.example/b.png">')).toBe(true);
  // A look-alike host is not ours.
  expect(externalWarning('<img src="https://droppage.dev.evil.example/i/AbCdEfGhIjKl.png">')).toBe(true);
});

test('root-relative droppage image links are not "relative assets"', () => {
  const relWarning = (body: string) =>
    validateHtmlUpload('r.html', Buffer.from(`<!doctype html><html><body>${body}</body></html>`)).warnings.some((w) => w.includes('relative assets'));
  expect(relWarning('<img src="/i/AbCdEfGhIjKl.svg">')).toBe(false);
  expect(relWarning('<img src="/img/logo.svg">')).toBe(true);
  expect(relWarning('<img src="./chart.png">')).toBe(true);
});
