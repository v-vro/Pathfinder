// The Pathfinder logo on each planner screen goes back to the home page.  node scripts/home-link-test.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const check = async (name, url, sel, prep) => {
  await p.goto(url);
  await p.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
  if (prep) await prep();
  await p.click(sel);
  await p.waitForURL('http://localhost:5173/', { timeout: 15000 });
  await p.waitForTimeout(800);
  console.log(`${name}: logo -> ${p.url()} | landing hero shown: ${!!(await p.$('a[href="/planner"]'))}`);
};
await check('scan screen', 'http://localhost:5173/planner', '.intake a.wordmark');
await check('reconstruction', 'http://localhost:5173/planner', '.recon a.wordmark', async () => {
  await p.click('text=Reconstruct');
  await p.waitForSelector('.recon', { timeout: 30000 });
});
await check('planner', 'http://localhost:5173/planner?plan', '.topbar a.wordmark');
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
