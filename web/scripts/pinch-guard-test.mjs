// False-pinch guards, fed synthetic landmarks straight into the tracker.  node scripts/pinch-guard-test.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.goto('http://localhost:5173/planner?plan', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pf?.tracker?.(), null, { timeout: 120000 });
const results = await page.evaluate(() => {
  const T = window.__pf.tracker().constructor;
  // a hand at (cx, cy): wrist below, index knuckle above; pinch = thumb tip on index tip
  const hand = (cx, cy, pinch) => {
    const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
    lm[0] = { x: cx, y: cy + 0.1, z: 0 };
    lm[5] = { x: cx - 0.02, y: cy, z: 0 };
    lm[9] = { x: cx, y: cy - 0.005, z: 0 };
    lm[13] = { x: cx + 0.02, y: cy, z: 0 };
    lm[17] = { x: cx + 0.04, y: cy + 0.01, z: 0 };
    lm[8] = { x: cx - 0.03, y: cy - 0.08, z: 0 };
    lm[4] = pinch ? { x: cx - 0.028, y: cy - 0.075, z: 0 } : { x: cx - 0.09, y: cy - 0.02, z: 0 };
    return { landmarks: [lm] };
  };
  const run = (frames, face = null) => {
    const t = new T();
    const seen = [];
    t.onHand = (h) => seen.push(h ? (h.pinch ? 'P' : 'o') : '-');
    if (face) t.faceBox = face;
    frames.forEach((f, i) => {
      if (face) t.faceBox.t = i * 33;
      t.processHand(f, i * 33);
    });
    return seen.join('');
  };
  const open = (n, x = 0.5, y = 0.6) => Array.from({ length: n }, () => hand(x, y, false));
  const pin = (n, x = 0.5, y = 0.6) => Array.from({ length: n }, () => hand(x, y, true));
  return {
    'real pinch (hand in view, fingers held together)': run([...open(10), ...pin(6), ...open(3)]),
    'phantom: 2-frame pinch flicker': run([...open(10), ...pin(2), ...open(5)]),
    'phantom: hand appears already pinching': run([{ landmarks: [] }, ...pin(4), { landmarks: [] }]),
    'hand on the face (head tracking on)': run([...pin(8, 0.5, 0.4)], { x0: 0.35, y0: 0.2, x1: 0.65, y1: 0.6, t: 0 }),
    'hand beside the face (head tracking on)': run([...open(8, 0.8, 0.6), ...pin(6, 0.8, 0.6)], { x0: 0.35, y0: 0.2, x1: 0.65, y1: 0.6, t: 0 }),
  };
});
for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(52)} ${v}`);
console.log('(o = hand, P = pinch, - = no hand)');
await browser.close();
