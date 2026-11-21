// Assemble the structured plan (single source of truth for the doctor plan and the patient explanation).
import type { CaseData } from './loadCase';
import { describeGeometry, type ProcedureGeometry } from './describe';
import type { Candidate, MapStats } from './planner';
import { EVIDENCE, PLEURAL_CONTACT_MM } from './riskModel';

export interface PlanJSON {
  disclaimer: string;
  source: string;
  target: {
    description: string;
    lobe: string;
    diameterMm: number;
    meanHU: number;
    pleuraDistanceMm: number | null;
  };
  geometry: ProcedureGeometry & { positionPlain: string; entryPlain: string };
  measurements: {
    totalMm: number;
    lesionDepthMm: number | null;
    chestWallMm: number | null;
    aeratedLungMm: number;
    pleuralAngleDeg: number | null;
    tiltDeg: number;
    fissuresCrossed: string[];
    emphysemaOnPathMm: number;
    bullaOnPath: boolean;
    closestVessel: string | null;
    vesselsCrossed: number;
  };
  risk: {
    pneumothorax: number;
    chestTube: number;
    haemorrhage: number;
    grade: string;
    baselinePneumothorax: number;
    baselineHaemorrhage: number;
    drivers: { label: string; value: string; addsPercentPoints: number; outcome: string }[];
    warnings: string[];
  };
  avoids: string[];
  cannotAvoid: string[];
  watchFor: string[];
  preProcedure: string[];
  modelCaveat: string;
  alternatives: { entry: string; pneumothorax: number; haemorrhage: number; why: string }[];
  patientStats: { emphysemaLAA950Pct: number };
}

const r1 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

export const WATCH_FOR = [
  'Roll the patient puncture-site down straight after needle removal (rapid rollover: chest drain OR 0.34 — Huo, CVIR 2019).',
  'Chest radiograph (or focal CT) at 1 hour (BTS 2003 via RCR audit). 89% of pneumothoraces are visible immediately and all needing intervention by 1 h (Perlmutt, AJR 1986).',
  'If a pneumothorax is seen: repeat the film 1 hour later; discharge if stable or improved. Small pneumothorax: biopsy side down, avoid coughing, low-flow O2 (Reid & Wallis 2017).',
  'Delayed pneumothorax occurs in ~3% beyond 3 hours (Choi, Chest 2004): give written advice before discharge.',
  'Escalate for breathlessness, chest pain worse on deep breathing, falling SpO2, or more than a small amount of fresh haemoptysis (small-volume haemoptysis ~4–5%).',
  'Higher-risk paths: consider tract sealing (blood patch / plug: chest drain OR 0.33–0.39, Huo 2019).',
];

export const PRE_PROCEDURE = [
  'Recent spirometry: FEV1 < 35% needs MDT review before biopsy (BTS 2003 via RCR audit).',
  'Coagulation: INR < 1.3; review anticoagulants / antiplatelets (Reid & Wallis 2017).',
  'Relative contraindications: contralateral pneumonectomy, positive-pressure ventilation, pulmonary hypertension.',
];

export function buildPlan(c: CaseData, cand: Candidate, stats: MapStats | null, alts: Candidate[] = []): PlanJSON {
  const a = cand.analysis;
  const risk = cand.risk;
  const g = describeGeometry(c, a);
  const t = c.meta.target;

  const avoids: string[] = [];
  const cannot: string[] = [];
  if (stats && stats.reachable) {
    const R = stats.reachable;
    const F = Math.max(1, stats.feasible);
    const NAMES: Record<string, string> = {
      rib: 'the ribs',
      'scapula (shoulder blade)': 'the scapula',
      spine: 'the spine',
      'sternum / clavicle / costal cartilage': 'the sternum, clavicle and costal cartilages',
      'great vessel (aorta / vena cava / pulmonary vein)': 'the great vessels',
      'trachea or oesophagus': 'the trachea and oesophagus',
      heart: 'the heart',
      'abdominal organ (below the diaphragm)': 'the liver and abdominal organs',
      exit: 'air gaps outside the body',
      fov: 'the area outside the scanned field of view',
      length: 'over-long paths',
    };
    for (const [k, n] of Object.entries(stats.blockedBy).sort((x, y) => y[1] - x[1])) {
      if (pct(n, R) < 5) continue;
      avoids.push(`Avoids ${NAMES[k] ?? k} — ${pct(n, R)}% of approaches within reach are blocked by ${k === 'exit' || k === 'length' || k === 'fov' ? 'these' : 'it'}.`);
    }
    if (!a.fissures.length && pct(stats.crossFissure, F) >= 10)
      avoids.push(`Stays within one lobe: ${pct(stats.crossFissure, F)}% of otherwise-feasible paths cross a fissure.`);
    if (a.emphysemaMm < 5 && pct(stats.crossEmphysema, F) >= 5)
      avoids.push(`Avoids emphysematous lung crossed by ${pct(stats.crossEmphysema, F)}% of feasible paths.`);
    const crossedBig = a.vesselsCrossed.some((v) => v.caliberMm >= 2);
    if (!crossedBig && pct(stats.crossVessel, F) >= 5)
      avoids.push(`Threads between pulmonary vessels: ${pct(stats.crossVessel, F)}% of feasible paths pass through a vessel ≥ 2 mm.`);
  }
  if (g.ribAbove && g.ribBelow)
    avoids.push(`Passes between ribs ${g.ribAbove.slice(1)} and ${g.ribBelow.slice(1)}; keep to the upper border of rib ${g.ribBelow.slice(1)} to spare the intercostal neurovascular bundle.`);

  if (a.aeratedLungMm >= PLEURAL_CONTACT_MM)
    cannot.push(`${(a.aeratedLungMm / 10).toFixed(1)} cm of aerated lung (the lesion is ${t.pleuraDistanceMm ?? '?'} mm from the nearest pleural surface).`);
  for (const f of a.fissures) cannot.push(`Crosses the ${f.name} (${f.from} → ${f.to}) at ${(f.depthMm / 10).toFixed(1)} cm depth.`);
  if (a.emphysemaMm >= 5) cannot.push(`${a.emphysemaMm.toFixed(0)} mm of emphysematous lung.`);
  if (a.bulla) cannot.push('A bulla on the path.');
  for (const v of a.vesselsCrossed.filter((v) => v.caliberMm >= 2))
    cannot.push(`A ${v.caliberMm.toFixed(1)} mm pulmonary vessel at ${(v.depthMm / 10).toFixed(1)} cm depth.`);
  if (a.nearestVessel && a.nearestVessel.clearanceMm > 0.25 && a.nearestVessel.clearanceMm < 3)
    cannot.push(`Passes ${a.nearestVessel.clearanceMm.toFixed(1)} mm from a ${a.nearestVessel.caliberMm.toFixed(1)} mm vessel.`);
  if (a.aeratedLungMm < PLEURAL_CONTACT_MM)
    avoids.push('Reaches the lesion where it touches the pleura — essentially no aerated lung is crossed.');
  if (a.pleuralAngleDeg !== null && a.pleuralAngleDeg < 45 && a.aeratedLungMm >= PLEURAL_CONTACT_MM)
    cannot.push(`Oblique pleural puncture (${a.pleuralAngleDeg.toFixed(0)}°; evidence on angle is mixed).`);
  if (!cannot.length) cannot.push('No major path risk factors identified.');

  const plainPosition: Record<string, string> = {
    supine: 'on your back',
    prone: 'face down on your stomach, with your arms above your head',
    'left lateral decubitus': 'on your left side',
    'right lateral decubitus': 'on your right side',
  };
  const plainSurface: Record<string, string> = {
    posterior: 'back',
    posterolateral: 'back, toward the side',
    lateral: 'side, under the arm',
    anterolateral: 'front, toward the side',
    anterior: 'front of the chest',
  };
  const upper = a.entry[2] > c.meta.target.center[2] - 30 ? 'upper ' : '';

  return {
    disclaimer: 'Decision support only. Risk figures are model estimates from published odds ratios applied to this anatomy.',
    source: `${c.meta.source}; anatomy by ${c.meta.stats.segmentation}`,
    target: {
      description: `${t.diameterMm.toFixed(0)} mm ${t.meanHU < -300 ? 'part-solid / ground-glass' : 'solid'} nodule, ${t.lobe}, ${t.pleuraDistanceMm ?? '?'} mm from the nearest pleura`,
      lobe: t.lobe,
      diameterMm: t.diameterMm,
      meanHU: t.meanHU,
      pleuraDistanceMm: t.pleuraDistanceMm,
    },
    geometry: {
      ...g,
      positionPlain: plainPosition[g.position],
      entryPlain: `${upper}${plainSurface[g.surface]}, on the ${g.side} side, between two ribs`,
    },
    measurements: {
      totalMm: r1(a.totalMm)!,
      lesionDepthMm: r1(a.lesionDepthMm),
      chestWallMm: r1(a.chestWallMm),
      aeratedLungMm: r1(a.aeratedLungMm)!,
      pleuralAngleDeg: r1(a.pleuralAngleDeg),
      tiltDeg: r1(a.tiltDeg)!,
      fissuresCrossed: a.fissures.map((f) => f.name),
      emphysemaOnPathMm: r1(a.emphysemaMm)!,
      bullaOnPath: a.bulla,
      closestVessel: a.nearestVessel
        ? `${a.nearestVessel.clearanceMm.toFixed(1)} mm from a ${a.nearestVessel.caliberMm.toFixed(1)} mm vessel`
        : null,
      vesselsCrossed: a.vesselsCrossed.filter((v) => v.caliberMm >= 2).length,
    },
    risk: {
      pneumothorax: Math.round(risk.ptx * 1000) / 1000,
      chestTube: Math.round(risk.chestTube * 1000) / 1000,
      haemorrhage: Math.round(risk.bleed * 1000) / 1000,
      grade: risk.grade,
      baselinePneumothorax: EVIDENCE.ptx.baseline,
      baselineHaemorrhage: EVIDENCE.bleed.baseline,
      drivers: risk.factors
        .filter((f) => Math.abs(f.deltaPts) >= 0.5)
        .sort((x, y) => y.deltaPts - x.deltaPts)
        .map((f) => ({ label: f.label, value: f.value, addsPercentPoints: Math.round(f.deltaPts * 10) / 10, outcome: f.outcome })),
      warnings: risk.warnings,
    },
    avoids,
    cannotAvoid: cannot,
    watchFor: WATCH_FOR,
    preProcedure: PRE_PROCEDURE,
    modelCaveat:
      'Odds ratios from different studies (Huo 2020 meta-analysis, Drumm 2019, Lee 2016, Zhu 2020) are combined in a logistic model calibrated to pooled rates (Heerink 2017). Stacking them double-counts somewhat: use for comparing paths, not as a calibrated individual probability. Vessel crossing has no published effect size and is shown as a warning.',
    alternatives: alts.slice(1).map((alt) => {
      const ga = describeGeometry(c, alt.analysis);
      const why: string[] = [];
      if (alt.analysis.fissures.length) why.push('crosses a fissure');
      if (alt.analysis.aeratedLungMm > a.aeratedLungMm + 5) why.push(`${((alt.analysis.aeratedLungMm - a.aeratedLungMm) / 10).toFixed(1)} cm more lung`);
      if (alt.analysis.vesselsCrossed.some((v) => v.caliberMm >= 2)) why.push('crosses a vessel');
      if (alt.analysis.tiltDeg > a.tiltDeg + 8) why.push('steeper tilt');
      return {
        entry: `${ga.positionText.split(' (')[0]}; ${ga.entryText}`,
        pneumothorax: Math.round(alt.risk.ptx * 1000) / 1000,
        haemorrhage: Math.round(alt.risk.bleed * 1000) / 1000,
        why: why.join(', ') || 'slightly higher combined risk',
      };
    }),
    patientStats: { emphysemaLAA950Pct: c.meta.stats.laa950Pct },
  };
}
