// Open and close both drawers; report any page errors.  node scripts/drawer-test.mjs <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 6).join('\n')}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text().slice(0, 400)}`));
await page.goto('http://localhost:5173/planner?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.click('text=Find safest path');
await page.waitForTimeout(1500);
for (const label of ['For patient', 'Plan']) {
  await page.click(`.actions button:has-text("${label}")`);
  await page.waitForTimeout(2500);
  await page.click('.drawer .icon-btn');
  await page.waitForTimeout(1200);
  const alive = await page.evaluate(() => !!document.querySelector('.actions') && document.getElementById('root').children.length > 0);
  console.log(`${label}: closed, app alive = ${alive}`);
  if (!alive) {
    console.log(errors.join('\n---\n'));
    break;
  }
}
await page.screenshot({ path: `${out}/drawer-after.png` });
console.log(errors.length ? errors.join('\n---\n') : 'no errors');
await browser.close();
