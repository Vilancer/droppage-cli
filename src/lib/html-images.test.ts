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

const A = 'https://droppage.dev/i/AAAAAAAAAAAA.webp';
const B = 'https://droppage.dev/i/BBBBBBBBBBBB.webp';
const C = 'https://droppage.dev/i/CCCCCCCCCCCC.png';

async function site(...files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'droppage-more-'));
  for (const file of files) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), 'x');
  }
  return dir;
}

test('srcset: every candidate URL is found and rewritten, descriptors kept', async () => {
  const dir = await site('hero-m.webp', 'hero-l.webp', 'img/logo.png');
  const html = `<picture><source media="(max-width: 600px)" srcset="hero-m.webp 1x, hero-l.webp 2x">`
    + `<img src="img/logo.png" srcset='hero-m.webp 600w,hero-l.webp 1200w , https://cdn.example.com/x.webp 3x' sizes="100vw" alt=""></picture>`
    + `<img data-srcset="hero-m.webp 1x">`;
  expect(findLocalImages(html, join(dir, 'r.html')).map((f) => f.ref)).toEqual(['hero-m.webp', 'hero-l.webp', 'img/logo.png']);
  const out = rewriteImageRefs(html, new Map([['hero-m.webp', A], ['hero-l.webp', B], ['img/logo.png', C]]));
  expect(out).toBe(`<picture><source media="(max-width: 600px)" srcset="${A} 1x, ${B} 2x">`
    + `<img src="${C}" srcset='${A} 600w,${B} 1200w , https://cdn.example.com/x.webp 3x' sizes="100vw" alt=""></picture>`
    + `<img data-srcset="hero-m.webp 1x">`);
});

test('srcset: a single URL, a trailing comma, and data: URIs with commas', async () => {
  const dir = await site('a.webp', 'b.webp');
  const html = '<img srcset="a.webp"><img srcset="b.webp,"><img srcset="data:image/png;base64,AA,BB 1x, a.webp 2x">';
  expect(findLocalImages(html, join(dir, 'r.html')).map((f) => f.ref)).toEqual(['a.webp', 'b.webp']);
  expect(rewriteImageRefs(html, new Map([['a.webp', A], ['b.webp', B]])))
    .toBe(`<img srcset="${A}"><img srcset="${B},"><img srcset="data:image/png;base64,AA,BB 1x, ${A} 2x">`);
});

test('icon links: rel icon, shortcut icon and apple-touch-icon, in any attribute order; other links untouched', async () => {
  const dir = await site('favicon.png', 'icons/touch.png', 'logo.svg');
  const html = '<link rel="icon" type="image/png" href="favicon.png">'
    + '<link href="icons/touch.png" rel="apple-touch-icon">'
    + "<link rel='shortcut icon' href='logo.svg'>"
    + '<link rel=icon href=favicon.png>'
    + '<link rel="preload" as="image" href="logo.svg"><link rel="stylesheet" href="favicon.png">';
  expect(findLocalImages(html, join(dir, 'r.html')).map((f) => f.ref)).toEqual(['favicon.png', 'icons/touch.png', 'logo.svg']);
  expect(rewriteImageRefs(html, new Map([['favicon.png', C], ['icons/touch.png', B], ['logo.svg', A]])))
    .toBe(`<link rel="icon" type="image/png" href="${C}">`
      + `<link href="${B}" rel="apple-touch-icon">`
      + `<link rel='shortcut icon' href='${A}'>`
      + `<link rel=icon href=${C}>`
      + '<link rel="preload" as="image" href="logo.svg"><link rel="stylesheet" href="favicon.png">');
});

test('url() in <style> blocks: quoted and bare, not in CSS comments or style attributes', async () => {
  const dir = await site('bg.webp', 'img/tile.png', 'old.png');
  const html = `<style>
  .hero { background: url("bg.webp") no-repeat; }
  .tile { background-image: url( img/tile.png ); }
  /* .old { background: url(old.png) } */
  .x { background: url('https://cdn.example.com/a.png'), url(data:image/png;base64,AA); }
</style><div style="background:url(old.png)"></div><p>url(bg.webp)</p>`;
  expect(findLocalImages(html, join(dir, 'r.html')).map((f) => f.ref)).toEqual(['bg.webp', 'img/tile.png']);
  const out = rewriteImageRefs(html, new Map([['bg.webp', A], ['img/tile.png', C]]));
  expect(out).toContain(`url("${A}") no-repeat`);
  expect(out).toContain(`url( ${C} )`);
  expect(out).toContain('/* .old { background: url(old.png) } */');
  expect(out).toContain('<p>url(bg.webp)</p>');
  expect(out).toContain('style="background:url(old.png)"');
});

test('the new patterns keep the folder rules: no ../, absolute paths or symlinks out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'droppage-outside2-'));
  await mkdir(join(root, 'site'));
  await mkdir(join(root, 'private'));
  await writeFile(join(root, 'secret.png'), 'x');
  await writeFile(join(root, 'private', 'p.png'), 'x');
  await symlink(join(root, 'private'), join(root, 'site', 'assets'));
  const html = `<img srcset="../secret.png 1x, ${join(root, 'secret.png')} 2x, assets/p.png 3x">`
    + `<link rel="icon" href="../secret.png"><link rel="icon" href="/secret.png">`
    + `<style>a{background:url(../secret.png)} b{background:url("assets/p.png")}</style>`;
  expect(findLocalImages(html, join(root, 'site', 'report.html'))).toEqual([]);
});
