import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.keyboard.press('2');
await page.waitForTimeout(800);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200); // zoom in
await page.waitForTimeout(1200);
await page.mouse.move(820, 470);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/v2-6-tubes-zoom.png` });
console.log(JSON.stringify(await page.evaluate(() => window.__pf.viewer.proximity)));
await browser.close();
