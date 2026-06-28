import puppeteer from 'puppeteer-core';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--hide-scrollbars']});
const p=await b.newPage();
await p.setViewport({width:1280,height:900,deviceScaleFactor:1});
await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
await p.goto('http://localhost:8100/outcomes/',{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,400));
const grids = await p.$$('.grid');
let target=null;
for (const g of grids){ const t=await p.evaluate(e=>e.innerText, g); if(t && t.includes('Capital One')){ target=g; break; } }
await (target||p).screenshot({path:'scripts/_shots/board.png'});
await b.close();console.log('shot');
