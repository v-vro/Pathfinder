import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => m.type() !== 'debug' && m.text().includes('centrel') && console.log('[console]', m.text()));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => { const v = window.__pf.viewer; return { segs: v.segs.length, lines: !!v.lineData }; })));
await page.keyboard.press('2'); // back
await page.waitForTimeout(1000);
const results = [];
for (const [x, y] of [[760, 420], [800, 480], [700, 520], [820, 380], [760, 560]]) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(250);
  results.push({ x, y, prox: await page.evaluate(() => window.__pf.viewer.proximity) });
}
console.log(JSON.stringify(results));
await page.mouse.move(760, 560);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/v2-5-tubes.png` });
await browser.close();
