// Safe-zone map (every skin vertex as a candidate entry) and automatic safest-path search.
import type { CaseData } from './loadCase';
import { analyzePath, entryFromDirection, MAX_NEEDLE_MM, type PathAnalysis } from './pathAnalysis';
import { assessRisk, type RiskResult } from './riskModel';
import type { Vec3 } from './types';
import { cross, dist, dot, norm, scale, sub } from './vec';

export interface MapStats {
  vertices: number;
  reachable: number; // within needle length
  feasible: number;
  blockedBy: Record<string, number>;
  crossFissure: number; // among feasible
  crossEmphysema: number;
  crossVessel: number;
  bestScore: number;
}

export interface SkinMap {
  score: Float32Array; // per vertex; NaN = blocked / unreachable
  colors: Float32Array; // RGBA per vertex
  stats: MapStats;
}

export interface Candidate {
  entry: Vec3;
  analysis: PathAnalysis;
  risk: RiskResult;
}

// RGBA: alpha drives how strongly the skin shows in the safe-zone map
const BLOCKED = [0.2, 0.14, 0.26, 0.05];
const FAR = [0.3, 0.3, 0.34, 0.03];

/** Risk-score colour ramp: green -> amber -> red. */
export function rampColor(s: number, lo: number, hi: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (s - lo) / Math.max(1e-6, hi - lo)));
  const stops: [number, number, number][] = [
    [0.13, 0.85, 0.48],
    [0.62, 0.86, 0.25],
    [0.98, 0.72, 0.16],
    [0.97, 0.33, 0.2],
    [0.85, 0.12, 0.25],
  ];
  const f = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const u = f - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export function computeSkinMap(c: CaseData, verts: Float32Array, normals: Float32Array | null, target: Vec3): SkinMap {
  const n = verts.length / 3;
  const score = new Float32Array(n).fill(NaN);
  const colors = new Float32Array(n * 4);
  const stats: MapStats = {
    vertices: n,
    reachable: 0,
    feasible: 0,
    blockedBy: {},
    crossFissure: 0,
    crossEmphysema: 0,
    crossVessel: 0,
    bestScore: Infinity,
  };
  for (let i = 0; i < n; i++) {
    const e: Vec3 = [verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]];
    const d = dist(e, target);
    if (d > MAX_NEEDLE_MM) {
      colors.set(FAR, 4 * i);
      continue;
    }
    stats.reachable++;
    const a = analyzePath(c, e, target, { fast: true });
    if (!a.feasible) {
      const b = a.blockers[0];
      const key = b ? (b.kind === 'organ' || b.kind === 'bone' ? b.name : b.kind) : 'other';
      stats.blockedBy[key] = (stats.blockedBy[key] ?? 0) + 1;
      colors.set(BLOCKED, 4 * i);
      continue;
    }
    const skinCos = normals ? skinIncidence(normals, i, a.dir) : 1;
    const r = assessRisk(c, a, { skinCos });
    score[i] = r.score;
    stats.feasible++;
    if (a.fissures.length) stats.crossFissure++;
    if (a.emphysemaMm >= 5 || a.bulla) stats.crossEmphysema++;
    if (a.nearestVessel && a.nearestVessel.clearanceMm <= 0.25 && a.nearestVessel.caliberMm >= 2) stats.crossVessel++;
    if (r.score < stats.bestScore) stats.bestScore = r.score;
  }
  // colour relative to this patient's achievable range: best path = green, median feasible path = orange
  const sorted = [...score].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const lo = stats.bestScore;
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : lo + 0.35;
  const hi = lo + Math.max(0.15, (median - lo) / 0.6);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(score[i])) {
      // safe zones glow, risky ones stay faint: the map should answer "where is it safe to go in?"
      const t = Math.max(0, Math.min(1, (score[i] - lo) / Math.max(1e-6, hi - lo)));
      colors.set([...rampColor(score[i], lo, hi), 0.95 - 0.6 * t], 4 * i);
    }
  }
  return { score, colors, stats };
}

function skinIncidence(normals: Float32Array, i: number, dir: Vec3) {
  // cosine between the inward skin normal and the needle direction (1 = perpendicular to the skin)
  const nx = normals[3 * i];
  const ny = normals[3 * i + 1];
  const nz = normals[3 * i + 2];
  return Math.max(0, -(nx * dir[0] + ny * dir[1] + nz * dir[2]));
}

/** Evaluate a path fully (fine sampling) for display. */
export function evaluate(c: CaseData, entry: Vec3, target: Vec3, skinCos = 1): Candidate {
  const analysis = analyzePath(c, entry, target);
  return { entry, analysis, risk: assessRisk(c, analysis, { skinCos }) };
}

/**
 * Safest path: start from the best skin-map vertices, then refine each with a local search over
 * needle directions (a cone around the current best), re-projecting onto the skin each time.
 * Returns the best plan and up to two clearly different alternatives.
 */
export function autoPlan(c: CaseData, verts: Float32Array, map: SkinMap, target: Vec3): Candidate[] {
  const n = map.score.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(map.score[i])) order.push(i);
  order.sort((a, b) => map.score[a] - map.score[b]);

  // seeds: best vertices that are at least 30 mm apart
  const seeds: Vec3[] = [];
  for (const i of order) {
    const e: Vec3 = [verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]];
    if (seeds.every((s) => dist(s, e) > 30)) seeds.push(e);
    if (seeds.length >= 6) break;
  }

  const refined: Candidate[] = [];
  for (const s of seeds) {
    let best = evaluate(c, s, target);
    let u0 = norm(sub(s, target));
    for (const stepDeg of [4, 2, 1]) {
      let improved = true;
      let guard = 0;
      while (improved && guard++ < 6) {
        improved = false;
        const { a: ax, b: bx } = basis(u0);
        for (const [da, db] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const r = (stepDeg * Math.PI) / 180;
          const u = norm([
            u0[0] + (ax[0] * da + bx[0] * db) * r,
            u0[1] + (ax[1] * da + bx[1] * db) * r,
            u0[2] + (ax[2] * da + bx[2] * db) * r,
          ]);
          const e = entryFromDirection(c, target, u);
          if (!e) continue;
          const cand = evaluate(c, e, target);
          if (cand.analysis.feasible && cand.risk.score < best.risk.score - 1e-4) {
            best = cand;
            u0 = u;
            improved = true;
          }
        }
      }
    }
    if (best.analysis.feasible) refined.push(best);
  }
  refined.sort((a, b) => a.risk.score - b.risk.score);
  const out: Candidate[] = [];
  for (const r of refined) {
    if (out.every((o) => dist(o.entry, r.entry) > 35)) out.push(r);
    if (out.length >= 3) break;
  }
  return out;
}

function basis(u: Vec3) {
  const ref: Vec3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const a = norm(cross(u, ref));
  const b = norm(cross(u, a));
  return { a, b };
}

export const _internal = { dot, scale };
