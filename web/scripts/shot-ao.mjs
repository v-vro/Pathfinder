// Debug: render the ambient-occlusion buffer and a close-up.  node scripts/shot-ao.mjs <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'warning' && console.log('[warn]', m.text().slice(0, 200)));
await page.goto('http://localhost:5173/?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.waitForTimeout(1000);
await page.evaluate(() => (window.__pf.viewer.gtao.output = 5)); // denoised AO only
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/ao-buffer.png` });
await page.evaluate(() => (window.__pf.viewer.gtao.output = 0));
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/ao-close.png` });
await page.evaluate(() => (window.__pf.viewer.hq = false));
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/ao-close-off.png` });
await browser.close();
