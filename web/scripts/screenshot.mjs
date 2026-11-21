// Visual smoke test: drives the system Edge/Chrome against the dev server and saves screenshots.
//   node scripts/screenshot.mjs <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-loaded.png` });
// aim with the mouse over the upper right back: turn the patient first
await page.keyboard.press('2');
await page.waitForTimeout(900);
await page.mouse.move(640, 330);
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/2-aim-back.png` });
await page.click('text=Find safest path');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/3-autoplan.png` });
await page.click("text=Doctor's plan");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/4-doctor.png` });
console.log(logs.slice(-30).join('\n'));
await browser.close();
