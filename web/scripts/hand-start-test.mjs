// Does the hand get detected right after Hand mode is first switched on?  node scripts/hand-start-test.mjs <hand.y4m> [runs]
import { chromium } from 'playwright';
const video = process.argv[2];
const runs = Number(process.argv[3] ?? 3);
for (let r = 0; r < runs; r++) {
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--use-angle=d3d11'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
  await page.goto('http://localhost:5173/planner?plan', { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
  await page.waitForTimeout(4000); // let the background preload finish, like a user reading the screen
  const t0 = Date.now();
  await page.click('button.mode:has-text("Hand")');
  const seen = [];
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const t = window.__pf.tracker();
      return t ? { ...t.stats, vw: t.video.videoWidth, rs: t.video.readyState, paused: t.video.paused } : null;
    });
    seen.push(s ? `${((Date.now() - t0) / 1000).toFixed(1)}s f${s.frames} ${s.fps}fps hand=${s.hand} ${s.vw}px rs${s.rs}${s.paused ? ' PAUSED' : ''}${s.error ? ' ERR ' + s.error : ''}` : 'no tracker');
  }
  console.log(`run ${r + 1}:\n  ` + seen.join('\n  '));
  const interesting = logs.filter((l) => !/vite|React DevTools/.test(l));
  if (interesting.length) console.log('  console:\n   ' + interesting.slice(0, 12).join('\n   '));
  await browser.close();
}
