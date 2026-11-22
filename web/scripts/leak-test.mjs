import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
const geo = () => page.evaluate(() => window.__pf.viewer.renderer.info.memory.geometries);
console.log('geometries before aiming', await geo());
for (let i = 0; i < 200; i++) { await page.mouse.move(560 + (i % 40) * 8, 360 + (i % 9) * 12); await page.waitForTimeout(16); }
console.log('geometries after 200 aims', await geo());
await browser.close();
