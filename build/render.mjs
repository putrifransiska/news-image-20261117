// Render page.html to a 1024x1024 PNG with headless Chromium (playwright-core).
// Usage: PLAYWRIGHT_DIR=<dir holding node_modules/playwright-core> node render.mjs page.html raw.png
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
const [src = 'page.html', out = 'raw.png'] = process.argv.slice(2);
const require = createRequire(join(resolve(process.env.PLAYWRIGHT_DIR ?? '.'), 'x.js'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.goto('file://' + resolve(src));
await page.waitForFunction(() => window.__shotReady === true);
await page.evaluate(() => document.fonts.ready);
const over = await page.evaluate(() => [...document.querySelectorAll('.lead,.panel,.also div,.foot,.bottom')]
  .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className + ':' + e.textContent.slice(0, 40)));
if (over.length) console.log('overflow:', over);
const bottom = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.also div')].map((e) => e.getBoundingClientRect().bottom)));
const foot = await page.evaluate(() => document.querySelector('.foot').getBoundingClientRect().top);
console.log('list bottom', bottom, 'footer top', foot);
await page.screenshot({ path: out, type: 'png' });
await browser.close();
