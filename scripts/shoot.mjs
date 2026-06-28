import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4399';
const OUT = 'scripts/_shots';
mkdirSync(OUT, { recursive: true });

const routes = [
  ['home', '/'],
  ['how', '/how/'],
  ['outcomes', '/outcomes/'],
  ['about', '/about/'],
  ['join', '/join/'],
  ['404', '/404.html'],
];

const viewports = [
  ['desktop', 1280, 900],
  ['mobile', 390, 844],
];

const reduceMotion = process.argv.includes('--reduce');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
});

for (const [vname, w, h] of viewports) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  if (reduceMotion) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  }
  for (const [name, path] of routes) {
    await page.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
    // settle a frame
    await new Promise((r) => setTimeout(r, 350));
    const file = `${OUT}/${name}-${vname}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log('shot', file);
  }
  await page.close();
}

await browser.close();
console.log('done');
