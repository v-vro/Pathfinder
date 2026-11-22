// Frame rate in several situations on the real GPU.  node scripts/perf-scenarios.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
await page.goto('http://localhost:5173/?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.waitForTimeout(1500);
const fps = (ms = 2500) =>
  page.evaluate(
    (ms) =>
      new Promise((res) => {
        let n = 0;
        let worst = 0;
        let last = performance.now();
        const t0 = last;
        const tick = () => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
          n++;
          if (now - t0 < ms) requestAnimationFrame(tick);
          else res(`${((n * 1000) / (now - t0)).toFixed(0)} fps, worst frame ${worst.toFixed(0)} ms`);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
const report = async (label) => console.log(label.padEnd(34), await fps());
await report('idle, front');
// mouse aiming: move continuously while measuring
const aim = (async () => {
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(600 + (i % 20) * 12, 380 + (i % 7) * 10);
    await page.waitForTimeout(40);
  }
})();
await report('mouse aiming');
await aim;
// simulated head movement (keyboard virtual head), continuous
const head = (async () => {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 10 < 5 ? 'ArrowRight' : 'ArrowLeft');
    await page.waitForTimeout(60);
  }
})();
await report('head moving');
await head;
await page.keyboard.press('0');
await page.click('text=Find safest path');
await page.waitForTimeout(1500);
await report('planned, back view');
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
await page.waitForTimeout(1200);
await report('side view');
await page.keyboard.press('0');
// A/B: switch off skin texture + extra lights
await page.evaluate(() => {
  const v = window.__pf.viewer;
  v.scene.traverse((o) => {
    if (o.isLight && o.type === 'DirectionalLight' && o.intensity === 1.0) o.visible = false;
  });
});
await page.waitForTimeout(800);
await report('planned, rim light off');
await browser.close();
