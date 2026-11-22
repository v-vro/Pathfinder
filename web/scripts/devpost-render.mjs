// Render the Devpost frames (3:2 at 2400x1600, plus a square icon).  node scripts/devpost-render.mjs
import { chromium } from 'playwright';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve('../devpost');
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
await page.goto('file:///' + resolve(dir, 'compose/frames.html').replace(/\\/g, '/'));
await page.waitForFunction(() => [...document.querySelectorAll('.crop[data-src]')].every((e) => e.dataset.ready), null, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const out = [
  ['main', 'thumbnail-main.jpg'],
  ['inside', '01-inside.jpg'],
  ['segment', '02-segmentation.jpg'],
  ['planner', '03-planner.jpg'],
  ['pipeline', '04-scan-to-plan.jpg'],
  ['layers', '05-segmentation-layers.jpg'],
];
for (const [id, file] of out) {
  const p = resolve(dir, file);
  await page.locator('#' + id).screenshot({ path: p, type: 'jpeg', quality: 92 });
  console.log(file, (statSync(p).size / 1e6).toFixed(2), 'MB');
}
await page.locator('#icon').screenshot({ path: resolve(dir, 'icon.png') });
console.log('icon.png', (statSync(resolve(dir, 'icon.png')).size / 1e6).toFixed(2), 'MB');
await browser.close();
