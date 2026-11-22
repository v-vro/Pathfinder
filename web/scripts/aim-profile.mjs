// Per-frame timing while aiming: records every frame's duration and how many were slow.
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await page.goto('http://localhost:5173/planner?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.waitForTimeout(1000);
const run = async (label) => {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__frames.push(now - last);
      last = now;
      if (window.__frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 150; i++) {
    await page.mouse.move(560 + (i % 40) * 8, 360 + (i % 9) * 12);
    await page.waitForTimeout(16);
  }
  const f = await page.evaluate(() => window.__frames);
  const slow = f.filter((x) => x > 34);
  const sorted = [...f].sort((a, b) => b - a);
  console.log(label.padEnd(18), `frames ${f.length}, >34ms: ${slow.length}, worst: ${sorted.slice(0, 4).map((x) => x.toFixed(0)).join(' ')} ms, median ${f.sort((a, b) => a - b)[Math.floor(f.length / 2)].toFixed(0)} ms`);
};
await run('first aiming');
await run('second aiming');
await browser.close();
