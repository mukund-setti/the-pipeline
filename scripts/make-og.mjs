/**
 * Generate public/og.png, the 1200x630 "Canopy & Light" social card.
 * Renders an inline HTML recreation of the brand (real woff2 fonts, gold
 * gradient word, light shaft, conduit) in headless Chrome via puppeteer-core.
 * Run: node scripts/make-og.mjs
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fs = (p) => 'file:///' + path.join(ROOT, 'node_modules', '@fontsource', p).replace(/\\/g, '/');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Fraunces; font-weight: 600; font-style: normal;
    src: url("${fs('fraunces/files/fraunces-latin-600-normal.woff2')}") format("woff2"); }
  @font-face { font-family: Fraunces; font-weight: 600; font-style: italic;
    src: url("${fs('fraunces/files/fraunces-latin-600-italic.woff2')}") format("woff2"); }
  @font-face { font-family: "Instrument Sans"; font-weight: 400; font-style: normal;
    src: url("${fs('instrument-sans/files/instrument-sans-latin-400-normal.woff2')}") format("woff2"); }
  @font-face { font-family: "Instrument Sans"; font-weight: 600; font-style: normal;
    src: url("${fs('instrument-sans/files/instrument-sans-latin-600-normal.woff2')}") format("woff2"); }

  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; }
  .card {
    position: relative; width: 1200px; height: 630px;
    background: #0F1912; color: #F3EEDC;
    padding: 60px 76px 54px;
    font-family: "Instrument Sans", sans-serif;
  }
  .shaft {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 60% 90% at 78% -10%, rgba(217,168,76,0.30), transparent 60%),
      radial-gradient(ellipse 40% 60% at 62% -5%, rgba(242,220,164,0.15), transparent 55%),
      linear-gradient(112deg, transparent 46%, rgba(217,168,76,0.06) 55%, transparent 68%);
  }
  .row { position: relative; display: flex; align-items: center; gap: 16px; }
  .tile {
    width: 72px; height: 72px; border-radius: 30%; background: #16241A;
    box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.10);
    display: grid; place-items: center;
  }
  .tile svg { width: 72px; height: 72px; }
  .wordmark { font-family: Fraunces, serif; font-weight: 600; font-size: 33px; letter-spacing: -0.01em; }
  h1 {
    position: relative; margin-top: 44px;
    font-family: Fraunces, serif; font-weight: 600; font-size: 95px;
    line-height: 1.06; letter-spacing: -0.015em;
  }
  .gold {
    font-style: italic;
    background-image: linear-gradient(100deg, #A9781F 0%, #D9A84C 45%, #F2DCA4 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    padding-right: 0.06em; /* keep the italic overhang inside the clip box */
  }
  .sub {
    position: relative; margin-top: 30px; max-width: 900px;
    font-size: 29px; line-height: 1.45; color: #A8B29A;
  }
  .conduit {
    position: absolute; left: 76px; right: 76px; bottom: 110px; height: 8px;
    border-radius: 999px; background: rgba(255,255,255,0.05); overflow: hidden;
  }
  .conduit i {
    position: absolute; inset: 0; display: block;
    background-image: radial-gradient(circle 3.5px at 8px 50%, #D9A84C 92%, transparent);
    background-size: 34px 100%; background-repeat: repeat-x;
  }
  .tip {
    position: absolute; right: 72px; bottom: 107px; width: 14px; height: 14px;
    border-radius: 999px; background: #E8BE6A;
    box-shadow: 0 0 0 7px rgba(217,168,76,0.18);
  }
  .foot {
    position: absolute; left: 76px; right: 76px; bottom: 48px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 21px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
  }
  .foot .meta { color: #A8B29A; }
  .foot .cta { color: #D9A84C; }
</style></head><body>
  <div class="card">
    <div class="shaft"></div>
    <div class="row">
      <span class="tile">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <g fill="none" stroke="#D9A84C" stroke-width="7" stroke-linecap="round">
            <path d="M34 62 a16 16 0 0 0 32 0"/><path d="M50 70 V42"/>
          </g>
          <path d="M50 52 C48 41 42 33 29 30 C31 42 39 50 50 52 Z" fill="#D9A84C"/>
          <path d="M50 43 C52 31 59 23 71 20 C69 33 61 41 50 43 Z" fill="#E8BE6A"/>
        </svg>
      </span>
      <span class="wordmark">The Pipeline</span>
    </div>
    <h1>The talent was<br><span class="gold">never</span> the problem.</h1>
    <p class="sub">A fellow-run community across the UC system handing gatekept access to the undergrads locked out of it.</p>
    <div class="conduit"><i></i></div>
    <span class="tip"></span>
    <div class="foot">
      <span class="meta">UC System &nbsp;·&nbsp; Undergrad Fellowship &nbsp;·&nbsp; Est. 2026</span>
      <span class="cta">Join the Pipeline &rarr;</span>
    </div>
  </div>
</body></html>`;

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await p.setContent(html, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: path.join(ROOT, 'public', 'og.png') });
await b.close();
console.log('saved public/og.png 1200x630');
