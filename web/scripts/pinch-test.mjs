// Pinch-to-aim test: scripted hand events (no real camera needed for the logic).
//   node scripts/pinch-test.mjs <fake-video.y4m>
import { chromium } from 'playwright';
const video = process.argv[2];
const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 120000 });
await page.keyboard.press('2'); // turn to the back, where the nodule is reachable
await page.waitForTimeout(900);
await page.click('button.mode:has-text("Hand")');
await page.waitForFunction(() => !!window.__pf.tracker(), null, { timeout: 30000 });
await page.evaluate(() => window.__pf.tracker().setEnabled(false, false)); // stop real detection; we drive onHand
const send = (nx, ny, pinch) => page.evaluate(([x, y, p]) => window.__pf.tracker().onHand({ nx: x, ny: y, pinch: p, depth: 0.2 }), [nx, ny, pinch]);
const state = () => page.evaluate(() => window.__pf.state());
const fmt = (s) => `${s.locked ? 'HELD ' : 'aim  '}${s.entry ? s.entry.map((v) => v.toFixed(0)).join(',') : '—'}`;

// 1) hover without pinching: nothing should aim
await send(0.15, 0.3, false);
await page.waitForTimeout(100);
console.log('open hand        ', fmt(await state()));
// 2) pinch and move slowly: needle follows
for (let i = 0; i <= 10; i++) {
  await send(0.1 + i * 0.01, 0.3 + i * 0.005, true);
  await page.waitForTimeout(40);
}
const aimed = await state();
console.log('pinched, aiming  ', fmt(aimed));
await page.waitForTimeout(250); // hold still
// 3) fingers open: last 60 ms jerk sideways, then release
await send(0.35, 0.45, true);
await page.waitForTimeout(30);
await send(0.45, 0.5, true);
await page.waitForTimeout(30);
await send(0.45, 0.5, false);
await page.waitForTimeout(150);
const held = await state();
console.log('released (held)  ', fmt(held));
const sameAsAimed = held.entry && aimed.entry && held.entry.every((v, i) => Math.abs(v - aimed.entry[i]) < 1);
console.log('held = pre-release aim (jerk ignored):', sameAsAimed);
// 4) moving the open hand must not change the held path
await send(-0.3, 0.1, false);
await page.waitForTimeout(150);
console.log('open hand moved  ', fmt(await state()));
// 5) pinch again: aiming resumes
await send(-0.2, 0.2, true);
await page.waitForTimeout(150);
console.log('pinch again      ', fmt(await state()));
// 6) lose the hand mid-pinch: holds last aim
await page.evaluate(() => window.__pf.tracker().onHand(null));
await page.waitForTimeout(150);
console.log('hand lost        ', fmt(await state()));
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
