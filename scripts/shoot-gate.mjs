import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4321';
const OUT = 'scripts/_shots';
mkdirSync(OUT, { recursive: true });

const states = [
  ['gate-choose', '/join/'],
  ['gate-codeSent', '/join/?gate=codeSent'],
  ['gate-verified', '/join/?gate=verified'],
  ['gate-blocked', '/join/?gate=blocked'],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 1 });
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

for (const [name, path] of states) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500)); // let the island hydrate + apply forced state
  const card = await page.$('.rounded-panel');
  const target = card || page;
  await target.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

await browser.close();
console.log('done');
