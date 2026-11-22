// Relative frame-rate check of the planner view.  node scripts/fps.mjs <outDir>
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/planner?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.waitForTimeout(1500);
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
        else res((n * 1000) / (performance.now() - t0));
      };
      requestAnimationFrame(tick);
    }),
);
console.log('fps', fps.toFixed(1), (await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })));
await page.screenshot({ path: `${out}/perf-front.png` });
await page.click('text=Find safest path');
await page.waitForTimeout(1600);
await page.screenshot({ path: `${out}/perf-back.png` });
await browser.close();
