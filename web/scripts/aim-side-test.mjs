// Pinch-aim sweeps across the body: every entry must be on the side facing the viewer.
//   node scripts/aim-side-test.mjs <fake-video.y4m>
import { chromium } from 'playwright';
const video = process.argv[2];
const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--use-angle=d3d11'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/planner?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.click('button.mode:has-text("Hand")');
await page.waitForFunction(() => window.__pf.tracker()?.stats.frames > 5, null, { timeout: 30000 }); // camera running (the tracker now exists before it starts)
await page.waitForTimeout(1500);
await page.evaluate(() => window.__pf.tracker().setEnabled(false, false)); // drive onHand ourselves
const send = (nx, ny, pinch) => page.evaluate(([x, y, p]) => window.__pf.tracker().onHand({ nx: x, ny: y, pinch: p, depth: 0.2 }), [nx, ny, pinch]);
const midY = await page.evaluate(() => window.__pf.viewer.torsoCenter.y); // LPS y: smaller = front, larger = back
for (const [key, side] of [['1', 'front'], ['2', 'back']]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(1200);
  let ok = 0, wrong = 0, none = 0;
  const wrongAt = [];
  for (const ny of [0.25, 0.05, -0.15]) {
    await send(-0.6, ny, false);
    await page.waitForTimeout(60);
    for (let i = 0; i <= 24; i++) {
      const nx = -0.6 + i * 0.05;
      await send(nx, ny, true);
      await page.waitForTimeout(35);
      const s = await page.evaluate(() => window.__pf.state());
      if (!s.entry) { none++; continue; }
      const front = s.entry[1] < midY;
      if ((side === 'front') === front) ok++;
      else { wrong++; wrongAt.push(`${nx.toFixed(2)},${ny} (${(s.entry[1] - midY).toFixed(0)} mm past midline)`); }
    }
    await send(0, ny, false);
    await page.waitForTimeout(200);
  }
  console.log(`${side} view: ${ok} entries on the ${side}, ${wrong} on the far side${wrong ? ' at ' + wrongAt.slice(0, 6).join(' ') : ''}, ${none} with no path yet`);
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
