// Raw screenshots for the Devpost images (3:2, 2x).  node scripts/devpost-capture.mjs <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const ready = () => page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
};
const HIDE_UI = `.topbar,.left,.right,.dock,.cam-msg,.hint,.foot,.disclaimer,footer,.hand-cursor{display:none!important}`;
const fine = page.locator('text=Planning aid only');

// ---------------------------------------------------------------- scan (tri-planar CT)
await page.goto('http://localhost:5173/planner');
await ready();
await page.waitForTimeout(2500);
await shot('ct-intake');

// ---------------------------------------------------------------- reconstruction steps
await page.click('text=Reconstruct');
await page.waitForSelector('.recon', { timeout: 30000 });
await page.waitForTimeout(3000);
for (const [i, name] of [
  [1, 'recon-skeleton'],
  [2, 'recon-lungs'],
  [4, 'recon-vessels'],
  [5, 'recon-nodule'],
]) {
  await page.click(`.rail li:nth-child(${i + 1}) button`);
  await page.waitForTimeout(2500);
  await shot(name);
}

// ---------------------------------------------------------------- planner
await page.goto('http://localhost:5173/planner?plan');
await ready();
await page.waitForTimeout(2000);
await page.click('text=Find safest path');
await page.waitForTimeout(2500);
await shot('planner-ui');

// clean 3D renders (UI hidden)
const css = await page.addStyleTag({ content: HIDE_UI });
if (await fine.count()) await fine.evaluate((e) => (e.style.display = 'none'));
const pose = async (yaw, pitch, zoom) => {
  await page.evaluate(
    ([y, p, z]) => {
      const v = window.__pf.viewer;
      v.targetYaw = y;
      v.targetPitch = p;
      if (z) v.targetZoom = z;
    },
    [yaw, pitch, zoom],
  );
  await page.waitForTimeout(1800);
};
await pose(Math.PI, 0, 0);
await shot('body-back-needle');
await pose(Math.PI + 0.55, 0.12, 0);
await shot('body-back-34-needle');
await pose(Math.PI + 0.55, 0.12, 1.6);
await shot('body-back-34-close');
await pose(-0.5, 0.1, 0);
await shot('body-front-34');
await pose(-0.5, 0.1, 1.7);
await shot('body-front-close');
console.log(errors.length ? errors.join('\n') : 'no page errors');
await css.evaluate((e) => e.remove());
await browser.close();
