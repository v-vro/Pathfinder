// Headless smoke test of the planning engine on a built case.
//   npx tsx scripts/engine-check.ts [caseId]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import type { CaseData } from '../src/engine/loadCase';
import { Volume } from '../src/engine/volume';
import type { CaseMeta, Vec3 } from '../src/engine/types';
import { entryFromDirection } from '../src/engine/pathAnalysis';
import { autoPlan, computeSkinMap, evaluate } from '../src/engine/planner';
import { buildPlan } from '../src/engine/plan';

const caseId = process.argv[2] ?? 'lidc-0742';
const dir = resolve(import.meta.dirname, '../public/cases', caseId);
const meta: CaseMeta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8'));
const u8 = (f: string) => new Uint8Array(gunzipSync(readFileSync(resolve(dir, f))));
const i16 = (f: string) => {
  const b = gunzipSync(readFileSync(resolve(dir, f)));
  return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
};
const f = meta.files;
const c: CaseData = {
  meta,
  base: '',
  labels: new Volume(meta.grid, u8(f.labels), 0),
  vclear: new Volume(meta.grid, u8(f.vclear), 255),
  vcal: new Volume(meta.grid, u8(f.vcal), 0),
  vclearL: new Volume(meta.grid, u8(f.vclearL), 255),
  emph: new Volume(meta.grid, u8(f.emph), 0),
  lung: new Volume(meta.grid, u8(f.lung), 0),
  ct: new Volume(meta.ctGrid, i16(f.ct), -1024),
  lines: null, fmaj: null, fmin: null, vsl: null,
};
const T = meta.target.center;
console.log('target', meta.target);

// pseudo skin: entry points for directions on a sphere around the target
const pts: number[] = [];
const N = 6000;
for (let i = 0; i < N; i++) {
  const z = 1 - (2 * (i + 0.5)) / N;
  const r = Math.sqrt(1 - z * z);
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  const e = entryFromDirection(c, T, [r * Math.cos(phi), r * Math.sin(phi), z]);
  if (e) pts.push(...e);
}
const verts = new Float32Array(pts);
let t0 = performance.now();
const map = computeSkinMap(c, verts, null, T);
console.log(`skin map over ${verts.length / 3} entries: ${(performance.now() - t0).toFixed(0)} ms`, map.stats);

t0 = performance.now();
const plans = autoPlan(c, verts, map, T);
console.log(`auto-plan: ${(performance.now() - t0).toFixed(0)} ms`);
for (const p of plans) {
  const a = p.analysis;
  console.log({
    entry: p.entry.map((v) => v.toFixed(1)).join(', '),
    ptx: (p.risk.ptx * 100).toFixed(1),
    tube: (p.risk.chestTube * 100).toFixed(1),
    bleed: (p.risk.bleed * 100).toFixed(1),
    grade: p.risk.grade,
    totalMm: a.totalMm.toFixed(1),
    chestWall: a.chestWallMm?.toFixed(1),
    aerated: a.aeratedLungMm.toFixed(1),
    fissures: a.fissures.map((x) => x.name),
    pleuralAngle: a.pleuralAngleDeg?.toFixed(0),
    tilt: a.tiltDeg.toFixed(0),
    nearestVessel: a.nearestVessel && `${a.nearestVessel.clearanceMm.toFixed(1)}mm/${a.nearestVessel.caliberMm.toFixed(1)}mm`,
    largeClear: a.minLargeVesselClearanceMm.toFixed(1),
  });
}
if (plans[0]) {
  const plan = buildPlan(c, plans[0], map.stats, plans);
  console.log(JSON.stringify({ geometry: plan.geometry, avoids: plan.avoids, cannotAvoid: plan.cannotAvoid, drivers: plan.risk.drivers }, null, 1));
}

// a deliberately bad path: straight anterior
const anterior = entryFromDirection(c, T, [0, -1, 0]) as Vec3;
const bad = evaluate(c, anterior, T);
console.log('anterior path:', {
  feasible: bad.analysis.feasible,
  blockers: bad.analysis.blockers.map((b) => `${b.name}@${b.depthMm.toFixed(0)}`),
  aerated: bad.analysis.aeratedLungMm.toFixed(0),
  fissures: bad.analysis.fissures.map((x) => x.name),
  ptx: (bad.risk.ptx * 100).toFixed(1),
});
