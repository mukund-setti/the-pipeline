import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4399';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
await new Promise((r) => setTimeout(r, 600));

// DropFeed: doubled list + animation running?
const marquee = await page.evaluate(() => {
  const track = document.querySelector('[data-marquee] > div');
  if (!track) return { found: false };
  const cs = getComputedStyle(track);
  return {
    found: true,
    childSpans: track.children.length,
    animationName: cs.animationName,
    paused: cs.animationPlayState,
    trackWiderThanParent: track.scrollWidth > track.parentElement.clientWidth,
  };
});

// Scroll the whole page so every ScrollReveal hydrates + fires.
await page.evaluate(async () => {
  const step = 400;
  for (let y = 0; y <= document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 600));
});

// After scrolling, are revealed elements visible (opacity 1, no transform)?
const reveal = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.lift')];
  const opacities = cards.map((c) => +getComputedStyle(c).opacity);
  const hidden = opacities.filter((o) => o < 0.99).length;
  return { cardCount: cards.length, hiddenAfterScroll: hidden, sample: opacities.slice(0, 6) };
});

console.log('MARQUEE', JSON.stringify(marquee));
console.log('REVEAL', JSON.stringify(reveal));

await page.screenshot({ path: 'scripts/_shots/home-motion-scrolled.png', fullPage: true });
await browser.close();
console.log('done');
