// Geometric analysis of a straight needle path from a skin entry point to the target.
// Pure measurement: no risk opinions here (see riskModel.ts).
import type { CaseData } from './loadCase';
import { L, LOBE_NAMES, fissureName, isBone, isForbiddenOrgan, isLobe, isLung, type Vec3 } from './types';
import { add, dot, len, norm, scale, sub } from './vec';

export type BlockKind = 'bone' | 'organ' | 'exit' | 'length' | 'fov';

export interface Blocker {
  kind: BlockKind;
  label: number;
  name: string;
  at: Vec3;
  depthMm: number;
}

export interface FissureCrossing {
  name: string;
  from: string;
  to: string;
  at: Vec3;
  depthMm: number;
}

export interface VesselEvent {
  at: Vec3;
  depthMm: number;
  clearanceMm: number;
  caliberMm: number;
}

export interface PathAnalysis {
  entry: Vec3;
  target: Vec3;
  dir: Vec3; // unit vector, entry -> target
  totalMm: number; // skin -> target centre
  lesionDepthMm: number | null; // skin -> lesion edge
  chestWallMm: number | null; // skin -> pleura
  aeratedLungMm: number; // lung parenchyma traversed before reaching the lesion
  pleuraPoint: Vec3 | null;
  pleuralAngleDeg: number | null; // needle vs pleural surface (90 = perpendicular)
  pleuralPunctures: number;
  fissures: FissureCrossing[];
  /** Closest approach to a predicted fissure that is NOT crossed, if within the AI boundary uncertainty. */
  fissureNear: { name: string; distanceMm: number; marginMm: number; at: Vec3 } | null;
  emphysemaMm: number; // path length through emphysematous lung (local LAA-950 >= 15 %)
  bulla: boolean;
  nearestVessel: VesselEvent | null; // closest approach to a vessel inside the lung, before the lesion
  vesselsCrossed: VesselEvent[]; // vessels the needle passes through (calibre >= 1.5 mm)
  minLargeVesselClearanceMm: number; // clearance to vessels >= 4 mm calibre
  blockers: Blocker[];
  lobes: string[];
  tiltDeg: number; // craniocaudal tilt out of the axial plane
  feasible: boolean;
}

export const MAX_NEEDLE_MM = 200;
/** Assumed uncertainty of AI-predicted fissure position (modelling choice, docs/segmentation-confidence.md). */
export const FISSURE_MARGIN = { major: 5, minor: 10 };
const EMPH_PCT = 15;

const BONE_NAMES: Record<number, string> = {
  [L.RIB]: 'rib',
  [L.SCAPULA]: 'scapula (shoulder blade)',
  [L.SPINE]: 'spine',
  [L.OTHER_BONE]: 'sternum / clavicle / costal cartilage',
};
const ORGAN_NAMES: Record<number, string> = {
  [L.HEART]: 'heart',
  [L.GREAT_VESSEL]: 'great vessel (aorta / vena cava / pulmonary vein)',
  [L.AIRWAY]: 'trachea or oesophagus',
  [L.ABDOMEN]: 'abdominal organ (below the diaphragm)',
};

export interface AnalyzeOptions {
  step?: number; // mm
  fast?: boolean; // skin-map mode: coarser, stops at first blocker, skips event lists
}

export function analyzePath(c: CaseData, entry: Vec3, target: Vec3, opts: AnalyzeOptions = {}): PathAnalysis {
  const step = opts.step ?? (opts.fast ? 1.0 : 0.4);
  const fast = !!opts.fast;
  const seg = sub(target, entry);
  const total = len(seg);
  const dir = norm(seg);
  const tiltDeg = (Math.asin(Math.min(1, Math.abs(dir[2]))) * 180) / Math.PI;

  const res: PathAnalysis = {
    entry,
    target,
    dir,
    totalMm: total,
    lesionDepthMm: null,
    chestWallMm: null,
    aeratedLungMm: 0,
    pleuraPoint: null,
    pleuralAngleDeg: null,
    pleuralPunctures: 0,
    fissures: [],
    fissureNear: null,
    emphysemaMm: 0,
    bulla: false,
    nearestVessel: null,
    vesselsCrossed: [],
    minLargeVesselClearanceMm: 63.75,
    blockers: [],
    lobes: [],
    tiltDeg,
    feasible: true,
  };

  if (total > MAX_NEEDLE_MM) {
    res.blockers.push({ kind: 'length', label: -1, name: `path longer than ${MAX_NEEDLE_MM / 10} cm`, at: entry, depthMm: total });
    if (fast) {
      res.feasible = false;
      return res;
    }
  }

  const { labels, lung, vclear, vcal, vclearL, emph } = c;
  let prevLobe = 0;
  let pendingLobe = 0;
  let pendingSince = 0;
  let pendingAt: Vec3 | null = null;
  let inLungRun = 0;
  let lungCounted = false;
  let boneRun = 0;
  let organRun = 0;
  let exitRun = 0;
  let prevLungVal = lung.linear(entry[0], entry[1], entry[2]);
  let inVessel = false;
  let vesselMaxCal = 0;
  let vesselStart: Vec3 | null = null;
  let vesselStartT = 0;
  let minClear = Infinity;
  let fMaj = Infinity;
  let fMin = Infinity;
  let fMajAt: Vec3 = entry;
  let fMinAt: Vec3 = entry;
  const lobesSeen = new Set<number>();

  const n = Math.max(1, Math.ceil(total / step));
  const dt = total / n;
  for (let s = 1; s <= n; s++) {
    const t = s * dt;
    const x = entry[0] + dir[0] * t;
    const y = entry[1] + dir[1] * t;
    const z = entry[2] + dir[2] * t;
    const lab = labels.nearest(x, y, z);
    const beforeLesion = res.lesionDepthMm === null;

    // ---- hard blockers (need a short run to ignore single-voxel segmentation noise)
    if (isBone(lab)) {
      boneRun += dt;
      if (boneRun >= 1.0 && boneRun < 1.0 + dt + 1e-6) {
        res.blockers.push({ kind: 'bone', label: lab, name: BONE_NAMES[lab] ?? 'bone', at: [x, y, z], depthMm: t });
        if (fast) break;
      }
    } else boneRun = 0;
    if (isForbiddenOrgan(lab)) {
      organRun += dt;
      if (organRun >= 1.5 && organRun < 1.5 + dt + 1e-6) {
        res.blockers.push({ kind: 'organ', label: lab, name: ORGAN_NAMES[lab] ?? 'organ', at: [x, y, z], depthMm: t });
        if (fast) break;
      }
    } else organRun = 0;
    if (lab === L.SYNTH) {
      res.blockers.push({ kind: 'fov', label: lab, name: 'outside the scanned field of view', at: [x, y, z], depthMm: t });
      break; // no image data: never plan through it
    }
    if (lab === L.OUTSIDE && t > 4) {
      exitRun += dt;
      if (exitRun >= 2 && exitRun < 2 + dt + 1e-6) {
        res.blockers.push({ kind: 'exit', label: 0, name: 'path leaves the body (air gap)', at: [x, y, z], depthMm: t });
        if (fast) break;
      }
    } else exitRun = 0;

    // ---- lesion
    if (lab === L.NODULE && beforeLesion) res.lesionDepthMm = t;

    // ---- pleura (smoothed lung field crossing 50 %)
    const lv = lung.linear(x, y, z);
    if (res.pleuraPoint === null && prevLungVal < 128 && lv >= 128) {
      const f = (128 - prevLungVal) / Math.max(1e-6, lv - prevLungVal);
      const tp = t - dt + f * dt;
      res.pleuraPoint = add(entry, scale(dir, tp));
      res.chestWallMm = tp;
    }
    prevLungVal = lv;

    // ---- lung occupancy, pleural punctures
    const inLung = isLung(lab);
    if (inLung) {
      inLungRun += dt;
      if (!lungCounted && inLungRun >= 1.0) {
        res.pleuralPunctures++;
        lungCounted = true;
      }
    } else if (!isLung(lab) && lab !== L.RIB) {
      if (inLungRun > 0 && lab !== L.NODULE) {
        // left the lung (only matters if we re-enter later)
        inLungRun = 0;
        lungCounted = false;
      }
    }

    if (isLobe(lab) && beforeLesion) {
      res.aeratedLungMm += dt;
      lobesSeen.add(lab);
      // ---- fissures: lobe label changes that persist >= 2 mm
      if (prevLobe === 0) prevLobe = lab;
      else if (lab !== prevLobe) {
        if (pendingLobe !== lab) {
          pendingLobe = lab;
          pendingSince = t;
          pendingAt = [x, y, z];
        } else if (t - pendingSince >= 2) {
          if (!fast)
            res.fissures.push({
              name: fissureName(prevLobe, lab),
              from: LOBE_NAMES[prevLobe],
              to: LOBE_NAMES[lab],
              at: pendingAt!,
              depthMm: pendingSince,
            });
          else res.fissures.push({ name: '', from: '', to: '', at: pendingAt!, depthMm: pendingSince });
          prevLobe = lab;
          pendingLobe = 0;
        }
      } else pendingLobe = 0;

      // ---- distance to predicted fissures (lobe boundaries are uncertain by several mm)
      if (c.fmaj) {
        const d = c.fmaj.linear(x, y, z) / 4;
        if (d < fMaj) {
          fMaj = d;
          fMajAt = [x, y, z];
        }
      }
      if (c.fmin) {
        const d = c.fmin.linear(x, y, z) / 4;
        if (d < fMin) {
          fMin = d;
          fMinAt = [x, y, z];
        }
      }

      // ---- emphysema / bullae
      const e = emph.nearest(x, y, z);
      if (e === 200) res.bulla = true;
      if (e >= EMPH_PCT) res.emphysemaMm += dt;

      // ---- vessels
      const clr = vclear.linear(x, y, z) / 4;
      if (clr < minClear) {
        minClear = clr;
        if (!fast)
          res.nearestVessel = { at: [x, y, z], depthMm: t, clearanceMm: clr, caliberMm: vcal.nearest(x, y, z) / 10 };
        else res.nearestVessel = { at: entry, depthMm: t, clearanceMm: clr, caliberMm: vcal.nearest(x, y, z) / 10 };
      }
      const clrL = vclearL.linear(x, y, z) / 4;
      if (clrL < res.minLargeVesselClearanceMm) res.minLargeVesselClearanceMm = clrL;
      const inside = clr <= 0.25;
      if (inside) {
        const cal = vcal.nearest(x, y, z) / 10;
        if (!inVessel) {
          inVessel = true;
          vesselStart = [x, y, z];
          vesselStartT = t;
          vesselMaxCal = cal;
        } else vesselMaxCal = Math.max(vesselMaxCal, cal);
      } else if (inVessel) {
        inVessel = false;
        if (vesselMaxCal >= 1.5)
          res.vesselsCrossed.push({ at: vesselStart!, depthMm: vesselStartT, clearanceMm: 0, caliberMm: vesselMaxCal });
      }
    }
  }

  // ---- pleural angle from the lung-field gradient (normal points into the lung)
  if (res.pleuraPoint) {
    const g = lung.gradient(res.pleuraPoint[0], res.pleuraPoint[1], res.pleuraPoint[2]);
    const gl = len(g);
    if (gl > 1e-6) {
      const cos = Math.abs(dot(dir, g) / gl);
      res.pleuralAngleDeg = (Math.asin(Math.min(1, cos)) * 180) / Math.PI;
    }
  }
  // near-miss of a predicted fissure (docs/segmentation-confidence.md: ~5 mm major, ~10 mm minor uncertainty)
  if (!res.fissures.length) {
    const mid = c.meta.landmarks.midlineX;
    const cands = [
      { d: fMaj, m: FISSURE_MARGIN.major, at: fMajAt, name: fMajAt[0] < mid ? 'right major (oblique) fissure' : 'left major (oblique) fissure' },
      { d: fMin, m: FISSURE_MARGIN.minor, at: fMinAt, name: 'right minor (horizontal) fissure' },
    ].filter((q) => q.d < q.m);
    cands.sort((p, q) => p.d / p.m - q.d / q.m);
    if (cands[0]) res.fissureNear = { name: cands[0].name, distanceMm: cands[0].d, marginMm: cands[0].m, at: cands[0].at };
  }
  // lesion touching the pleura: no aerated lung crossed
  if (res.lesionDepthMm === null) res.lesionDepthMm = total;
  res.lobes = [...lobesSeen].map((l) => LOBE_NAMES[l]);
  res.feasible = res.blockers.length === 0;
  return res;
}

/** March outward from the target along `u` and return the skin point where the needle would enter. */
export function entryFromDirection(c: CaseData, target: Vec3, u: Vec3, maxMm = 260): Vec3 | null {
  const d = norm(u);
  let lastInside: Vec3 | null = null;
  let outsideRun = 0;
  for (let t = 0; t <= maxMm; t += 0.75) {
    const p: Vec3 = [target[0] + d[0] * t, target[1] + d[1] * t, target[2] + d[2] * t];
    const lab = c.labels.nearest(p[0], p[1], p[2]);
    if (lab !== L.OUTSIDE) {
      lastInside = p;
      outsideRun = 0;
    } else {
      outsideRun += 0.75;
      if (outsideRun >= 6 && lastInside) return lastInside;
    }
  }
  return lastInside;
}
