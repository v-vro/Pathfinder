// Score distribution over the real skin mesh (parses anatomy.glb directly).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import type { CaseData } from '../src/engine/loadCase';
import { Volume } from '../src/engine/volume';
import type { CaseMeta } from '../src/engine/types';
import { computeSkinMap, evaluate } from '../src/engine/planner';

const dir = resolve(import.meta.dirname, '../public/cases', process.argv[2] ?? 'lidc-0742');
const meta: CaseMeta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8'));
const u8 = (f: string) => new Uint8Array(gunzipSync(readFileSync(resolve(dir, f))));
const i16 = (f: string) => { const b = gunzipSync(readFileSync(resolve(dir, f))); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
const f = meta.files;
const c: CaseData = { meta, base: '', labels: new Volume(meta.grid, u8(f.labels), 0), vclear: new Volume(meta.grid, u8(f.vclear), 255), vcal: new Volume(meta.grid, u8(f.vcal), 0), vclearL: new Volume(meta.grid, u8(f.vclearL), 255), emph: new Volume(meta.grid, u8(f.emph), 0), lung: new Volume(meta.grid, u8(f.lung), 0), ct: new Volume(meta.ctGrid, i16(f.ct), -1024), lines: null, fmaj: null, fmin: null, vsl: null };

const glb = readFileSync(resolve(dir, 'anatomy.glb'));
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = glb.subarray(20 + jsonLen + 8);
const node = gltf.nodes.find((n: any) => n.name === 'skin');
const prim = gltf.meshes[node.mesh].primitives[0];
const acc = gltf.accessors[prim.attributes.POSITION];
const bv = gltf.bufferViews[acc.bufferView];
const verts = new Float32Array(bin.buffer.slice(bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + acc.count * 12));
const T = meta.target.center;
const m = computeSkinMap(c, verts, null, T);
const s = [...m.score].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
const q = (p: number) => s[Math.floor(p * (s.length - 1))].toFixed(3);
console.log('feasible', s.length, 'quantiles 0/10/25/50/75/90:', q(0), q(0.1), q(0.25), q(0.5), q(0.75), q(0.9));
for (const p of [0, 0.1, 0.5, 0.9]) {
  const target = s[Math.floor(p * (s.length - 1))];
  const i = [...m.score].findIndex((x) => x === target);
  const e: [number, number, number] = [verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]];
  const cand = evaluate(c, e, T);
  console.log(`q${p}`, 'score', target.toFixed(3), 'ptx', cand.risk.ptx.toFixed(3), 'bleed', cand.risk.bleed.toFixed(3), 'tube', cand.risk.chestTube.toFixed(3), 'L', cand.analysis.aeratedLungMm.toFixed(0), 'total', cand.analysis.totalMm.toFixed(0), 'tilt', cand.analysis.tiltDeg.toFixed(0), 'pos', cand.risk.factors.find((f) => f.key === 'position')?.value);
}
