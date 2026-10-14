import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { findLocalImages, rewriteImageRefs } from './html-images.js';

test('finds the local images a page uses and rewrites only those', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'droppage-html-'));
  await mkdir(join(dir, 'img'));
  await writeFile(join(dir, 'chart.png'), 'x');
  await writeFile(join(dir, 'img', 'logo v2.svg'), 'x');
  const html = `<img src="chart.png"><img src='img/logo%20v2.svg' alt=x>
    <img src="https://cdn.example.com/a.png"><img src="data:image/png;base64,AA"><img src="missing.png">
    <img src="chart.png"><img src="notes.txt"><picture><source src="chart.png"></picture>`;

  const found = findLocalImages(html, join(dir, 'report.html'));
  expect(found.map((f) => f.ref)).toEqual(['chart.png', 'img/logo%20v2.svg']);
  expect(found[1].path).toBe(join(dir, 'img', 'logo v2.svg'));

  const out = rewriteImageRefs(html, new Map([
    ['chart.png', 'https://droppage.dev/i/AAAAAAAAAAAA.png'],
    ['img/logo%20v2.svg', 'https://droppage.dev/i/BBBBBBBBBBBB.svg'],
  ]));
  expect(out).toContain(`<img src="https://droppage.dev/i/AAAAAAAAAAAA.png">`);
  expect(out).toContain(`<img src='https://droppage.dev/i/BBBBBBBBBBBB.svg' alt=x>`);
  expect(out).toContain('<source src="https://droppage.dev/i/AAAAAAAAAAAA.png">');
  expect(out).toContain('<img src="https://cdn.example.com/a.png">');
  expect(out).toContain('<img src="missing.png">');
  expect(out.match(/AAAAAAAAAAAA/g)).toHaveLength(3);
});

test('never picks up files outside the HTML folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'droppage-outside-'));
  await mkdir(join(root, 'site'));
  await writeFile(join(root, 'secret.png'), 'x');
  await writeFile(join(root, 'site', 'ok.png'), 'x');
  const html = `<img src="../secret.png"><img src="${join(root, 'secret.png')}"><img src="sub/../../secret.png"><img src="ok.png">`;
  expect(findLocalImages(html, join(root, 'site', 'report.html')).map((f) => f.ref)).toEqual(['ok.png']);
});

test('a symlink out of the folder is not followed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'droppage-link-'));
  await mkdir(join(root, 'site'));
  await mkdir(join(root, 'private'));
  await writeFile(join(root, 'private', 'secret.png'), 'x');
  await symlink(join(root, 'private', 'secret.png'), join(root, 'site', 'innocent.png'));
  await symlink(join(root, 'private'), join(root, 'site', 'assets'));
  const html = '<img src="innocent.png"><img src="assets/secret.png">';
  expect(findLocalImages(html, join(root, 'site', 'report.html'))).toEqual([]);
});

test('data-src is not src, and only the src value is rewritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'droppage-attr-'));
  await writeFile(join(dir, 'chart.png'), 'x');
  await writeFile(join(dir, 'lazy.png'), 'x');
  const html = '<img data-src="lazy.png" alt="chart.png" src="chart.png">';
  expect(findLocalImages(html, join(dir, 'report.html')).map((f) => f.ref)).toEqual(['chart.png']);
  expect(rewriteImageRefs(html, new Map([['chart.png', 'https://droppage.dev/i/AAAAAAAAAAAA.png']])))
    .toBe('<img data-src="lazy.png" alt="chart.png" src="https://droppage.dev/i/AAAAAAAAAAAA.png">');
});
