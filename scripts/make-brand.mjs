/**
 * Generate the logo kit in public/brand/ ("Canopy & Light" cut):
 *   the-pipeline-mark-tile.png   sprout on the canopy tile (1024x1024)
 *   the-pipeline-mark-white.png  sprout on white (1024x1024)
 *   the-pipeline-mark.png        sprout, transparent (1024x1024)
 *   the-pipeline-wordmark-light.png  "The P(sprout)peline" for light surfaces (transparent)
 *   the-pipeline-wordmark-dark.png   same lockup, cream on canopy
 * Run: node scripts/make-brand.mjs
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'public', 'brand');
mkdirSync(OUT, { recursive: true });
const fs = (p) => 'file:///' + path.join(ROOT, 'node_modules', '@fontsource', p).replace(/\\/g, '/');

/** The sprout, shared by every asset. Full version includes the conduit cup. */
const SPROUT = `
  <g fill="none" stroke="#D9A84C" stroke-width="7" stroke-linecap="round">
    <path d="M34 62 a16 16 0 0 0 32 0"/><path d="M50 70 V42"/>
  </g>
  <path d="M50 52 C48 41 42 33 29 30 C31 42 39 50 50 52 Z" fill="#D9A84C"/>
  <path d="M50 43 C52 31 59 23 71 20 C69 33 61 41 50 43 Z" fill="#E8BE6A"/>`;

/** Narrow crop (no cup, stem to the baseline) that stands in for the "i". */
const SPROUT_I = `
  <path d="M50 96 V42" fill="none" stroke="#D9A84C" stroke-width="11" stroke-linecap="round"/>
  <path d="M50 52 C48 41 42 33 29 30 C31 42 39 50 50 52 Z" fill="#D9A84C"/>
  <path d="M50 43 C52 31 59 23 71 20 C69 33 61 41 50 43 Z" fill="#E8BE6A"/>`;

const mark = (bg) => `<!doctype html><html><head><style>
    * { margin: 0; }
    body { width: 1024px; height: 1024px; background: ${bg}; overflow: hidden; }
    .tile { width: 1024px; height: 1024px; display: grid; place-items: center; }
    svg { width: 1024px; height: 1024px; }
  </style></head><body>
    <div class="tile"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${SPROUT}</svg></div>
  </body></html>`;

const tile = `<!doctype html><html><head><style>
    * { margin: 0; }
    body { width: 1024px; height: 1024px; background: transparent; overflow: hidden; }
    .tile { width: 1024px; height: 1024px; border-radius: 30%; background: #0F1912; display: grid; place-items: center; }
    svg { width: 1024px; height: 1024px; }
  </style></head><body>
    <div class="tile"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${SPROUT}</svg></div>
  </body></html>`;

const wordmark = (fg, bg) => `<!doctype html><html><head><style>
    @font-face { font-family: Fraunces; font-weight: 600; font-style: normal;
      src: url("${fs('fraunces/files/fraunces-latin-600-normal.woff2')}") format("woff2"); }
    * { margin: 0; }
    body { width: 2200px; height: 560px; background: ${bg}; overflow: hidden; }
    .lockup {
      width: 2200px; height: 560px; display: flex; align-items: center; justify-content: center;
      font-family: Fraunces, serif; font-weight: 600; font-size: 300px;
      letter-spacing: -0.01em; color: ${fg}; white-space: pre;
    }
    .i {
      display: inline-block; height: 0.76em; width: auto; margin: 0 -0.032em 0 -0.02em;
      vertical-align: baseline; transform: translateY(0.012em);
    }
  </style></head><body>
    <div class="lockup">The P<svg class="i" viewBox="24 12 52 84" xmlns="http://www.w3.org/2000/svg">${SPROUT_I}</svg>peline</div>
  </body></html>`;

const jobs = [
  { file: 'the-pipeline-mark-tile.png', html: tile, w: 1024, h: 1024, transparent: true },
  { file: 'the-pipeline-mark-white.png', html: mark('#FFFFFF'), w: 1024, h: 1024 },
  { file: 'the-pipeline-mark.png', html: mark('transparent'), w: 1024, h: 1024, transparent: true },
  { file: 'the-pipeline-wordmark-light.png', html: wordmark('#222B20', 'transparent'), w: 2200, h: 560, transparent: true },
  { file: 'the-pipeline-wordmark-dark.png', html: wordmark('#F3EEDC', '#0F1912'), w: 2200, h: 560 },
];

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const p = await b.newPage();
for (const j of jobs) {
  await p.setViewport({ width: j.w, height: j.h, deviceScaleFactor: 1 });
  await p.setContent(j.html, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 150));
  await p.screenshot({ path: path.join(OUT, j.file), omitBackground: !!j.transparent });
  console.log('saved brand/' + j.file);
}
await b.close();
