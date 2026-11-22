// More Devpost renders: a front-entry needle (main thumbnail) and clean reconstruction-step views.
//   node scripts/devpost-capture-2.mjs <outDir>
import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const ready = () => page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });

// ---------------------------------------------------------------- front needle: search entry points through the chest opening
await page.goto('http://localhost:5173/planner?plan');
await ready();
await page.waitForTimeout(2500);
await page.keyboard.press('1');
await page.waitForTimeout(1500);
const read = () =>
  page.evaluate(() => ({
    grade: document.querySelector('.card .grade')?.textContent ?? '',
    ptx: parseFloat(document.querySelector('.headline .big')?.textContent ?? 'NaN'),
    entry: window.__pf.state().entry,
  }));
const found = [];
for (let y = 300; y <= 600; y += 30)
  for (let x = 480; x <= 960; x += 30) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(70);
    const r = await read();
    if (r.entry && r.grade && r.grade !== 'Blocked') found.push({ x, y, ...r });
  }
found.sort((a, b) => a.ptx - b.ptx);
console.log(`${found.length} unblocked front entries; best:`, found.slice(0, 5).map((f) => `${f.x},${f.y} ${f.grade} ${f.ptx}%`).join(' | '));
// prefer an entry well inside the opening so the needle shows against the anatomy
const pick = found.find((f) => f.x > 560 && f.x < 880 && f.y > 340 && f.y < 560) ?? found[0];
console.log('picked', pick?.x, pick?.y, pick?.grade, pick?.ptx);
await page.mouse.move(pick.x, pick.y);
await page.waitForTimeout(200);
await page.mouse.click(pick.x, pick.y);
await page.waitForTimeout(800);
await page.addStyleTag({ content: `.topbar,.left,.right,.dock,.cam-msg,.hint,.hand-cursor{display:none!important}` });
await page.evaluate(() => [...document.querySelectorAll('*')].forEach((e) => e.children.length === 0 && e.textContent === 'Planning aid only.' && (e.style.display = 'none')));
await page.mouse.move(5, 5);
const pose = async (name, yaw, pitch, zoom) => {
  await page.evaluate(
    ([y, p, z]) => {
      const v = window.__pf.viewer;
      v.targetYaw = y;
      v.targetPitch = p;
      v.targetZoom = z;
    },
    [yaw, pitch, zoom],
  );
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
};
const z0 = await page.evaluate(() => window.__pf.viewer.targetZoom);
await pose('front-needle', 0, 0.05, z0);
await pose('front-needle-34', -0.38, 0.08, z0 * 1.25);
await pose('front-needle-close', -0.25, 0.06, z0 * 1.55);

// ---------------------------------------------------------------- reconstruction steps, clean (no slice plane, no UI)
await page.goto('http://localhost:5173/planner');
await ready();
await page.click('text=Reconstruct');
await page.waitForSelector('.recon', { timeout: 30000 });
await page.waitForTimeout(2500);
await page.uncheck('.plane-toggle input');
await page.addStyleTag({ content: `.legend-list,.plane-toggle,.model-loading{display:none!important}` });
for (const [i, name] of [
  [0, 'seg-body'],
  [1, 'seg-skeleton'],
  [2, 'seg-lobes'],
  [3, 'seg-heart'],
  [4, 'seg-vessels'],
  [5, 'seg-nodule'],
]) {
  await page.click(`.rail li:nth-child(${i + 1}) button`);
  await page.waitForTimeout(2200);
  await page.locator('section.model').screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
