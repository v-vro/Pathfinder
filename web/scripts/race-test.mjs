// Turn on Head then Hand quickly on a fresh page (models still loading). Is hand tracking actually enabled?
//   node scripts/race-test.mjs <hand.y4m> [first=Head] [second=Hand]
import { chromium } from 'playwright';
const [video, first = 'Head', second = 'Hand'] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--use-angle=d3d11'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
const page = await ctx.newPage();
await page.goto('http://localhost:5173/planner?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.click(`button.mode:has-text("${first}")`);
await page.waitForTimeout(400);
await page.click(`button.mode:has-text("${second}")`);
await page.waitForTimeout(9000);
const s = await page.evaluate(() => {
  const t = window.__pf.tracker();
  return { vid: { paused: t.video.paused, rs: t.video.readyState, ct: t.video.currentTime, w: t.video.videoWidth, inDom: t.video.isConnected }, running: t.running, opts: t.opts, stats: t.stats, on: [...document.querySelectorAll('button.mode')].map((b) => `${b.textContent}:${b.className}`) };
});
console.log(`${first} then ${second}:`, JSON.stringify(s));
await browser.close();
