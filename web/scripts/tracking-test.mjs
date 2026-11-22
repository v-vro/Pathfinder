// Tracking smoke test with a fake webcam:  node scripts/tracking-test.mjs <video.y4m> <outDir> [head|hand]
import { chromium } from 'playwright';
const [video, out, which = 'head'] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.click(which === 'head' ? 'button.mode:has-text("Head")' : 'button.mode:has-text("Hand")');
const samples = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(500);
  samples.push(await page.evaluate(() => {
    const pf = window.__pf; const h = pf.viewer.head;
    const tr = pf.tracker(); const st = tr?.stats; const vv = tr?.video; return { st, vid: vv && { paused: vv.paused, t: +vv.currentTime.toFixed(2), rs: vv.readyState, inDoc: vv.isConnected, w: vv.videoWidth },  head: [Math.round(h.x), Math.round(h.y), Math.round(h.z)], msg: document.querySelector('.cam-msg')?.textContent ?? '', live: [...document.querySelectorAll('.led.live')].length, cursor: !!document.querySelector('.hand-cursor') };
  }));
}
console.log(JSON.stringify(samples));
await page.screenshot({ path: `${out}/track-${which}.png` });
console.log(logs.filter((l) => !l.includes('vite')).slice(-25).join('\n'));
await browser.close();
