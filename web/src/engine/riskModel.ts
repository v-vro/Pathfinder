// Evidence-based complication risk for a needle path. Coefficients and sources: docs/risk-evidence.md.
//
// Logistic models  p = 1 / (1 + exp(-(b0 + sum beta_i * x_i)))  with beta_i = ln(OR_i) from published studies.
// Intercepts are calibrated so a reference path reproduces the pooled meta-analytic rate.
// Caveat (shown in the UI): the ORs come from different studies with different adjustment sets, so stacking them
// double-counts somewhat. Outputs are estimates for comparing paths, not calibrated individual probabilities.
//
// Each factor's contribution is reported as a counterfactual: how many percentage points the risk would drop if
// that factor were at its best value. Patient-level factors (same for every path) are shown versus their absence.
import type { CaseData } from './loadCase';
import type { PathAnalysis } from './pathAnalysis';
import { choosePosition, positionBeta } from './describe';
import { scale } from './vec';

export type Tone = 'good' | 'neutral' | 'warn' | 'bad';
export type Outcome = 'ptx' | 'bleed' | 'tube';

export interface Factor {
  key: string;
  outcome: Outcome;
  label: string;
  value: string;
  detail: string;
  deltaPts: number; // percentage points this factor adds vs. its best value
  tone: Tone;
  patientLevel?: boolean;
  noEffectSize?: boolean; // evidence shows direction only (no published OR)
  source?: string;
}

export interface RiskResult {
  ptx: number;
  chestTube: number;
  bleed: number;
  score: number; // planning objective (lower is better)
  grade: 'low' | 'moderate' | 'high' | 'blocked';
  factors: Factor[];
  warnings: string[];
}

export const EVIDENCE = {
  ptx: {
    b0: -1.89, // reference path (1.5 cm aerated lung, nothing else) -> 25.3 % (Heerink 2017 pooled core rate)
    baseline: 0.253,
    aeratedPerCm: { beta: 0.54, cap: 4, src: 'Lee HY 2016, OR 1.71/cm (Iran J Radiol, PMID 27895865)' },
    pleuralBased: { beta: -0.55, src: 'Huo 2020 meta-analysis, no pleural contact OR 1.73 (PMID 31860329)' },
    fissure: { beta: 1.32, src: 'Huo 2020 meta-analysis, OR 3.75 (2.57–5.46)' },
    bulla: { beta: 1.81, src: 'Huo 2020, OR 6.13 (1 study)' },
    emphysemaPath: { beta: 0.74, minMm: 5, src: 'Drumm 2019 Radiology, OR 2.1 (PMID 31084480)' },
    emphysemaPatient: { beta: 1.2, laaPct: 6, src: 'Huo 2020 meta-analysis, OR 3.33 (2.15–5.16)' },
    extraPuncture: { beta: 0.89, src: 'Huo 2020, >1 pleural puncture OR 2.43' },
    smallLesion: { beta: 0.68, thresholdMm: 20, src: 'Huo 2020, lesion ≤2 cm OR 1.98' },
    position: {
      sideDown: -0.99,
      sideUp: 1.16,
      src: 'Drumm 2019 (biopsy-side-down, OR 2.7 for prone/supine vs it); Huo 2020 (biopsied lung up, OR 3.20)',
    },
    angleNote: { below: 45, src: 'Pooled effect null (Huo 2020); single studies: Ko 2001 (<80°), Hiraki 2010 (<45°)' },
  },
  tube: {
    b0: -3.48, // 3.0 % reference (Yoon 2019, 10,568 biopsies)
    typical: 1 / (1 + Math.exp(3.48 - 0.68)), // non-pleural path, no other factor ≈ 5.7 % (pooled 5.6–6.9 %)
    emphysema: { beta: 1.86, src: 'Huo 2020, OR 6.44' },
    bulla: { beta: 2.4, src: 'Huo 2020, OR 11.04 (1 study)' },
    fissure: { beta: 1.26, src: 'Huo 2020, OR 3.54' },
    noPleuralContact: { beta: 0.68, src: 'Huo 2020, OR 1.97' },
  },
  bleed: {
    b0: -1.52, // depth ≤3 cm, lesion ≤3 cm, solid, upper lobe -> 18.0 % (Heerink 2017 pooled core rate)
    baseline: 0.18,
    depth3to5: { beta: 1.52, src: 'Zhu 2020, depth 3–5 cm OR 4.56 (PMID 32489925)' },
    depthOver5: { beta: 3.24, src: 'Zhu 2020, depth >5 cm OR 25.6 (wide CI)' },
    largeLesion: { beta: -0.49, src: 'Zhu 2020, lesion ≤3 cm OR 1.63' },
    ggo: { beta: 0.86, huBelow: -300, src: 'Chiu 2022, GGO OR 2.36' },
    lowerLobe: { beta: 0.56, src: 'Zhu 2020, lower lobe OR 1.75–1.95' },
    vessel: { minCaliberMm: 2, src: 'Nour-Eldin 2014; Bingham 2020 — strongest factor, no published OR' },
  },
};

const sigm = (x: number) => 1 / (1 + Math.exp(-x));
export const PLEURAL_CONTACT_MM = 5;

interface Term {
  key: string;
  outcome: Outcome;
  beta: number;
  x: number; // this path
  best: number; // counterfactual for "how much does this add"
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  patientLevel?: boolean;
  source: string;
}

export interface AssessOptions {
  skinCos?: number;
}

export function assessRisk(c: CaseData, a: PathAnalysis, opts: AssessOptions = {}): RiskResult {
  const E = EVIDENCE;
  const tgt = c.meta.target;
  const warnings: string[] = [];
  const T: Term[] = [];
  const extra: Factor[] = [];

  const Lcm = a.aeratedLungMm / 10;
  // "Lesion abuts the pleura": < 5 mm of aerated lung (≈ 3 voxels at the 1.5 mm analysis resolution)
  const pleuralBased = a.aeratedLungMm < PLEURAL_CONTACT_MM;
  const lowerLobe = tgt.lobeLabel === 11 || tgt.lobeLabel === 14;
  const patientEmph = c.meta.stats.laa950Pct >= E.ptx.emphysemaPatient.laaPct;
  const pathEmph = a.emphysemaMm >= E.ptx.emphysemaPath.minMm;
  const fissure = a.fissures.length > 0;

  // ------------------------------------------------------------- pneumothorax
  T.push({
    key: 'aerated',
    outcome: 'ptx',
    beta: E.ptx.aeratedPerCm.beta,
    x: Math.min(Lcm, E.ptx.aeratedPerCm.cap),
    best: 0,
    label: 'Lung crossed',
    value: `${Lcm.toFixed(1)} cm`,
    detail: pleuralBased
      ? 'The lesion is reached directly from the pleura: no air-filled lung is crossed.'
      : `The needle crosses ${Lcm.toFixed(1)} cm of air-filled lung before the lesion — the most consistent geometric predictor of pneumothorax.`,
    tone: Lcm < 1 ? 'good' : Lcm < 2 ? 'neutral' : Lcm < 3 ? 'warn' : 'bad',
    source: E.ptx.aeratedPerCm.src,
  });
  T.push({
    key: 'pleuralBased',
    outcome: 'ptx',
    beta: E.ptx.pleuralBased.beta,
    x: pleuralBased ? 1 : 0,
    best: pleuralBased ? 1 : 0,
    label: 'Pleural contact',
    value: pleuralBased ? 'yes' : 'no',
    detail: pleuralBased ? 'Lesion abuts the pleura along this path (protective).' : 'Lesion does not touch the pleura on this path.',
    tone: pleuralBased ? 'good' : 'neutral',
    source: E.ptx.pleuralBased.src,
  });
  T.push({
    key: 'fissure',
    outcome: 'ptx',
    beta: E.ptx.fissure.beta,
    x: fissure ? 1 : 0,
    best: 0,
    label: 'Fissure',
    value: fissure ? `${a.fissures.length} crossed` : 'none',
    detail: fissure
      ? `Crosses the ${a.fissures.map((f) => f.name).join(' and ')} — two extra pleural layers are punctured.`
      : 'Stays within one lobe — no interlobar fissure is crossed.',
    tone: fissure ? 'bad' : 'good',
    source: E.ptx.fissure.src,
  });
  if (a.fissureNear) {
    const fn = a.fissureNear;
    extra.push({
      key: 'fissureNear',
      outcome: 'ptx',
      label: 'Near fissure',
      value: `${fn.distanceMm.toFixed(0)} mm`,
      detail: `Passes ${fn.distanceMm.toFixed(0)} mm from the predicted ${fn.name}. AI lobe boundaries are typically off by about ${fn.marginMm} mm, so this path may actually cross it.`,
      deltaPts: 0,
      tone: 'warn',
      noEffectSize: true,
      source: 'Boundary uncertainty: Amini & Klein 2025; fissure completeness reviews (docs/segmentation-confidence.md)',
    });
    warnings.push(`Possible fissure crossing: ${fn.distanceMm.toFixed(0)} mm from the predicted ${fn.name} (uncertainty ±${fn.marginMm} mm).`);
  }
  T.push({
    key: 'emphPath',
    outcome: 'ptx',
    beta: E.ptx.emphysemaPath.beta,
    x: pathEmph ? 1 : 0,
    best: 0,
    label: 'Emphysema on path',
    value: a.emphysemaMm >= 1 ? `${a.emphysemaMm.toFixed(0)} mm` : 'none',
    detail: pathEmph
      ? `Passes through ${a.emphysemaMm.toFixed(0)} mm of emphysematous lung (local LAA-950 ≥ 15 %).`
      : 'No emphysematous lung along the path.',
    tone: pathEmph ? 'bad' : 'good',
    source: E.ptx.emphysemaPath.src,
  });
  if (a.bulla) {
    T.push({
      key: 'bulla',
      outcome: 'ptx',
      beta: E.ptx.bulla.beta,
      x: 1,
      best: 0,
      label: 'Bulla on path',
      value: 'crossed',
      detail: 'The needle passes through a bulla (a large air space).',
      tone: 'bad',
      source: E.ptx.bulla.src,
    });
    warnings.push('Path crosses a bulla — avoid if at all possible.');
  }
  const pos = choosePosition(scale(a.dir, -1), tgt.center[0] < c.meta.landmarks.midlineX ? 'right' : 'left');
  const pb = positionBeta(pos.kind);
  T.push({
    key: 'position',
    outcome: 'ptx',
    beta: 1,
    x: pb,
    best: Math.min(pb, 0),
    label: 'Position',
    value: pos.short,
    detail:
      pos.kind === 'sideDown'
        ? 'This approach allows lying biopsy-side-down, which limits motion of the punctured lung.'
        : pos.kind === 'sideUp'
          ? 'A lateral approach forces the biopsied lung uppermost — the highest-risk position.'
          : `Approach requires ${pos.short}; biopsy-side-down is not possible from this entry.`,
    tone: pos.kind === 'sideDown' ? 'good' : pos.kind === 'sideUp' ? 'bad' : 'neutral',
    source: E.ptx.position.src,
  });
  if (a.pleuralPunctures > 1) {
    T.push({
      key: 'punctures',
      outcome: 'ptx',
      beta: E.ptx.extraPuncture.beta,
      x: 1,
      best: 0,
      label: 'Pleural punctures',
      value: `${a.pleuralPunctures}`,
      detail: 'The path leaves and re-enters the lung.',
      tone: 'bad',
      source: E.ptx.extraPuncture.src,
    });
  }
  const small = tgt.diameterMm <= E.ptx.smallLesion.thresholdMm;
  T.push({
    key: 'size',
    outcome: 'ptx',
    beta: E.ptx.smallLesion.beta,
    x: small ? 1 : 0,
    best: 0,
    patientLevel: true,
    label: 'Lesion size',
    value: `${tgt.diameterMm.toFixed(0)} mm`,
    detail: small ? 'Lesions ≤ 2 cm carry higher risk (patient-level).' : 'Lesion > 2 cm (patient-level).',
    tone: small ? 'warn' : 'neutral',
    source: E.ptx.smallLesion.src,
  });
  T.push({
    key: 'emphPatient',
    outcome: 'ptx',
    beta: E.ptx.emphysemaPatient.beta,
    x: patientEmph ? 1 : 0,
    best: 0,
    patientLevel: true,
    label: 'Emphysema (whole lung)',
    value: `LAA-950 ${c.meta.stats.laa950Pct.toFixed(1)} %`,
    detail: patientEmph
      ? `Whole-lung low-attenuation area ${c.meta.stats.laa950Pct.toFixed(1)} % (≥ ${E.ptx.emphysemaPatient.laaPct} %): emphysema present (patient-level).`
      : `Whole-lung LAA-950 ${c.meta.stats.laa950Pct.toFixed(1)} % (< ${E.ptx.emphysemaPatient.laaPct} %): no significant emphysema.`,
    tone: patientEmph ? 'bad' : 'good',
    source: E.ptx.emphysemaPatient.src,
  });
  if (a.pleuralAngleDeg !== null && !pleuralBased) {
    const shallow = a.pleuralAngleDeg < E.ptx.angleNote.below;
    extra.push({
      key: 'angle',
      outcome: 'ptx',
      label: 'Pleural angle',
      value: `${a.pleuralAngleDeg.toFixed(0)}°`,
      detail: `Needle meets the pleura at ${a.pleuralAngleDeg.toFixed(0)}° (90° = perpendicular). Pooled evidence shows no consistent effect; some single studies associate oblique punctures with more pneumothorax.`,
      deltaPts: 0,
      tone: shallow ? 'warn' : 'good',
      noEffectSize: true,
      source: E.ptx.angleNote.src,
    });
  }

  // ------------------------------------------------------------- chest tube
  T.push({ key: 't_emph', outcome: 'tube', beta: E.tube.emphysema.beta, x: patientEmph ? 1 : 0, best: 0, patientLevel: true, label: 'Emphysema', value: '', detail: '', tone: 'neutral', source: E.tube.emphysema.src });
  T.push({ key: 't_bulla', outcome: 'tube', beta: E.tube.bulla.beta, x: a.bulla ? 1 : 0, best: 0, label: 'Bulla', value: '', detail: '', tone: 'neutral', source: E.tube.bulla.src });
  T.push({ key: 't_fis', outcome: 'tube', beta: E.tube.fissure.beta, x: fissure ? 1 : 0, best: 0, label: 'Fissure', value: '', detail: '', tone: 'neutral', source: E.tube.fissure.src });
  T.push({ key: 't_contact', outcome: 'tube', beta: E.tube.noPleuralContact.beta, x: pleuralBased ? 0 : 1, best: 0, label: 'No pleural contact', value: '', detail: '', tone: 'neutral', source: E.tube.noPleuralContact.src });

  // ------------------------------------------------------------- haemorrhage
  const depthBand = Lcm > 5 ? 2 : Lcm > 3 ? 1 : 0;
  T.push({
    key: 'bleedDepth',
    outcome: 'bleed',
    beta: 1,
    x: depthBand === 2 ? E.bleed.depthOver5.beta : depthBand === 1 ? E.bleed.depth3to5.beta : 0,
    best: 0,
    label: 'Depth',
    value: depthBand === 2 ? '> 5 cm' : depthBand === 1 ? '3–5 cm' : '≤ 3 cm',
    detail: `Lesion edge is ${Lcm.toFixed(1)} cm deep along the path; bleeding rises steeply beyond 3 cm.`,
    tone: depthBand === 0 ? 'good' : depthBand === 1 ? 'warn' : 'bad',
    source: depthBand === 2 ? E.bleed.depthOver5.src : E.bleed.depth3to5.src,
  });
  const ggo = tgt.meanHU < E.bleed.ggo.huBelow;
  T.push({
    key: 'ggo',
    outcome: 'bleed',
    beta: E.bleed.ggo.beta,
    x: ggo ? 1 : 0,
    best: 0,
    patientLevel: true,
    label: 'Density',
    value: `${tgt.meanHU.toFixed(0)} HU`,
    detail: ggo ? 'Ground-glass / part-solid lesion (patient-level).' : 'Solid lesion (patient-level).',
    tone: ggo ? 'warn' : 'neutral',
    source: E.bleed.ggo.src,
  });
  T.push({
    key: 'bleedSize',
    outcome: 'bleed',
    beta: E.bleed.largeLesion.beta,
    x: tgt.diameterMm > 30 ? 1 : 0,
    best: 0,
    patientLevel: true,
    label: 'Lesion size',
    value: `${tgt.diameterMm.toFixed(0)} mm`,
    detail: tgt.diameterMm > 30 ? 'Lesion > 3 cm (protective).' : 'Lesions ≤ 3 cm bleed more often (patient-level).',
    tone: 'neutral',
    source: E.bleed.largeLesion.src,
  });
  if (lowerLobe)
    T.push({
      key: 'lowerLobe',
      outcome: 'bleed',
      beta: E.bleed.lowerLobe.beta,
      x: 1,
      best: 0,
      patientLevel: true,
      label: 'Lower lobe',
      value: tgt.lobe,
      detail: 'Lower-lobe lesions bleed more often (patient-level).',
      tone: 'warn',
      source: E.bleed.lowerLobe.src,
    });
  const crossed = a.vesselsCrossed.filter((v) => v.caliberMm >= E.bleed.vessel.minCaliberMm);
  const nv = a.nearestVessel;
  extra.push({
    key: 'vessel',
    outcome: 'bleed',
    label: crossed.length ? 'Vessel on path' : 'Closest vessel',
    value: crossed.length
      ? `${crossed.length} crossed`
      : nv
        ? `${nv.clearanceMm.toFixed(0)} mm · ⌀${nv.caliberMm.toFixed(1)}`
        : 'none nearby',
    detail: crossed.length
      ? 'The needle passes through a visible pulmonary vessel — the strongest reported bleeding factor (direction well established; no published effect size).'
      : nv && nv.clearanceMm < 2
        ? `Passes ${nv.clearanceMm.toFixed(1)} mm from a ${nv.caliberMm.toFixed(1)} mm vessel — inside the 2 mm safety margin used for segmentation uncertainty.`
        : 'No pulmonary vessel ≥ 2 mm lies on the path.',
    deltaPts: 0,
    tone: crossed.length ? 'bad' : nv && nv.clearanceMm < 2 ? 'warn' : 'good',
    noEffectSize: true,
    source: E.bleed.vessel.src,
  });
  if (crossed.length) warnings.push(`Needle crosses ${crossed.length} pulmonary vessel${crossed.length > 1 ? 's' : ''} ≥ 2 mm.`);

  // ------------------------------------------------------------- combine
  const b0 = { ptx: E.ptx.b0, tube: E.tube.b0, bleed: E.bleed.b0 };
  const model = (o: Outcome, override?: { key: string; x: number }) => {
    let z = b0[o];
    for (const t of T) {
      if (t.outcome !== o) continue;
      z += t.beta * (override && override.key === t.key ? override.x : t.x);
    }
    return sigm(z);
  };
  const ptx = model('ptx');
  const bleed = model('bleed');
  const chestTube = Math.min(model('tube'), ptx);

  const factors: Factor[] = T.filter((t) => t.outcome !== 'tube').map((t) => {
    const p = t.outcome === 'ptx' ? ptx : bleed;
    return {
      key: t.key,
      outcome: t.outcome,
      label: t.label,
      value: t.value,
      detail: t.detail,
      deltaPts: (p - model(t.outcome, { key: t.key, x: t.best })) * 100,
      tone: t.tone,
      patientLevel: t.patientLevel,
      source: t.source,
    };
  });
  factors.push(...extra);

  // ------------------------------------------------------------- planning objective
  let score = ptx + 0.6 * bleed + 1.5 * chestTube;
  score += crossed.reduce((s, v) => s + 0.04 + 0.02 * v.caliberMm, 0); // vessels: penalty, not a fabricated OR
  // vessel safety margins (modelling choice, docs/segmentation-confidence.md): avoid < 2 mm, soft cost to 5 mm
  if (nv && !crossed.length && nv.caliberMm >= 1.5) {
    if (nv.clearanceMm < 2) score += 0.03 + (2 - nv.clearanceMm) * 0.03;
    else if (nv.clearanceMm < 5) score += (5 - nv.clearanceMm) * 0.006;
  }
  if (a.fissureNear) score += 0.08 * (1 - a.fissureNear.distanceMm / a.fissureNear.marginMm);
  if (a.minLargeVesselClearanceMm < 5) score += (5 - a.minLargeVesselClearanceMm) * 0.02;
  if (a.totalMm > 120) score += ((a.totalMm - 120) / 10) * 0.01;
  if (a.tiltDeg > 15) score += (a.tiltDeg - 15) * 0.004;
  const skinCos = opts.skinCos ?? 1;
  if (skinCos < 0.5) score += (0.5 - skinCos) * 0.2;

  if (a.tiltDeg > 25) warnings.push(`Steep craniocaudal angulation (${a.tiltDeg.toFixed(0)}°).`);
  if (a.totalMm > 150) warnings.push(`Long path (${(a.totalMm / 10).toFixed(1)} cm) — needs a 15–20 cm introducer.`);
  if (a.minLargeVesselClearanceMm < 5)
    warnings.push(`Passes within ${a.minLargeVesselClearanceMm.toFixed(1)} mm of a large (≥ 4 mm) pulmonary vessel.`);

  let grade: RiskResult['grade'] = ptx < 0.15 && !fissure && !a.fissureNear && !a.bulla && !crossed.length ? 'low' : ptx < 0.3 && !a.bulla ? 'moderate' : 'high';
  if (!a.feasible) {
    grade = 'blocked';
    score = Infinity;
  }
  return { ptx, chestTube, bleed, score, grade, factors, warnings };
}
