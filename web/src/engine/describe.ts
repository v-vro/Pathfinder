// Turns a path into the language of the procedure room: position, intercostal space,
// distance from the spinous processes, needle angle and tilt, depths, needle length.
import type { CaseData } from './loadCase';
import type { PathAnalysis } from './pathAnalysis';
import type { Vec3 } from './types';
import { deg, dist, dot, norm, scale, sub } from './vec';

export type Position = 'supine' | 'prone' | 'left lateral decubitus' | 'right lateral decubitus';

export interface ProcedureGeometry {
  position: Position;
  positionText: string;
  upVector: Vec3;
  side: 'right' | 'left';
  surface: 'anterior' | 'posterior' | 'lateral' | 'anterolateral' | 'posterolateral';
  entryText: string;
  ribAbove: string | null;
  ribBelow: string | null;
  icsText: string;
  fromMidlineMm: number;
  tableZmm: number;
  targetZmm: number;
  angleFromVerticalDeg: number;
  angleText: string;
  tiltDeg: number;
  tiltText: string;
  needleText: string;
}

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

const UP: Record<Position, Vec3> = {
  supine: [0, -1, 0], // anterior faces the ceiling
  prone: [0, 1, 0], // posterior faces the ceiling
  'left lateral decubitus': [-1, 0, 0], // lying on the left side: patient's right is up
  'right lateral decubitus': [1, 0, 0],
};

export type PositionKind = 'sideDown' | 'sideUp' | 'neutral';
export interface PositionChoice {
  position: Position;
  kind: PositionKind;
  short: string;
}

/** ln(OR) for position (docs/risk-evidence.md): biopsy-side-down protective, biopsied-lung-up harmful. */
export function positionBeta(kind: PositionKind) {
  return kind === 'sideDown' ? -0.99 : kind === 'sideUp' ? 1.16 : 0;
}

/**
 * Lowest-risk position in which the entry site does not face the table.
 * Evidence: lying biopsy-side-down lowers pneumothorax (Drumm 2019); lateral with the biopsied lung up raises it (Huo 2020).
 */
export function choosePosition(outward: Vec3, lesionSide: 'right' | 'left'): PositionChoice {
  const sideDown: Position = lesionSide === 'right' ? 'right lateral decubitus' : 'left lateral decubitus';
  const sideUp: Position = lesionSide === 'right' ? 'left lateral decubitus' : 'right lateral decubitus';
  const kindOf = (p: Position): PositionKind => (p === sideDown ? 'sideDown' : p === sideUp ? 'sideUp' : 'neutral');
  const options = (Object.keys(UP) as Position[])
    .filter((p) => dot(outward, scale(UP[p], -1)) < 0.45) // entry must not face the table
    .map((p) => ({ p, beta: positionBeta(kindOf(p)), up: dot(outward, UP[p]) }));
  if (!options.length) options.push({ p: 'supine', beta: 0, up: 0 });
  options.sort((a, b) => a.beta - b.beta || b.up - a.up);
  const p = options[0].p;
  const short =
    p === 'supine' ? 'supine' : p === 'prone' ? 'prone' : p === sideDown ? 'biopsy side down' : 'biopsied lung up';
  return { position: p, kind: kindOf(p), short };
}

function nearestRibs(c: CaseData, p: Vec3) {
  const cand: { name: string; d: number; dz: number }[] = [];
  for (const [name, pts] of Object.entries(c.meta.ribs)) {
    let best = Infinity;
    let bz = 0;
    for (const q of pts) {
      const d = dist(p, q);
      if (d < best) {
        best = d;
        bz = q[2] - p[2];
      }
    }
    if (best < 45) cand.push({ name, d: best, dz: bz });
  }
  const above = cand.filter((r) => r.dz > 0).sort((a, b) => a.d - b.d)[0] ?? null;
  const below = cand.filter((r) => r.dz <= 0).sort((a, b) => a.d - b.d)[0] ?? null;
  return { above, below };
}

export function describeGeometry(c: CaseData, a: PathAnalysis): ProcedureGeometry {
  const outward = scale(a.dir, -1);
  const lesionSide = a.target[0] < c.meta.landmarks.midlineX ? 'right' : 'left';
  const choice = choosePosition(outward, lesionSide);
  const position = choice.position;
  const up = UP[position];
  const side = a.entry[0] < c.meta.landmarks.midlineX ? 'right' : 'left';

  // where on the chest wall
  const ap = -outward[1]; // + anterior
  const lat = Math.abs(outward[0]);
  let surface: ProcedureGeometry['surface'];
  if (lat < 0.38) surface = ap > 0 ? 'anterior' : 'posterior';
  else if (lat > 0.85) surface = 'lateral';
  else surface = ap > 0 ? 'anterolateral' : 'posterolateral';

  // ribs around the point where the needle crosses the rib cage (just outside the pleura)
  const ribProbe =
    a.pleuraPoint && a.chestWallMm !== null
      ? sub(a.pleuraPoint, scale(a.dir, Math.min(6, a.chestWallMm * 0.3)))
      : a.entry;
  const { above, below } = nearestRibs(c, ribProbe);
  const num = (r: { name: string } | null) => (r ? parseInt(r.name.slice(1), 10) : null);
  const na = num(above);
  const nb = num(below);
  let icsText = 'intercostal space could not be determined';
  if (na) icsText = `${side} ${ORD[na] ?? na + 'th'} intercostal space (between ribs ${na} and ${nb ?? na + 1})`;
  else if (nb) icsText = `above the ${ORD[nb]} rib`;

  const fromMidline = Math.abs(a.entry[0] - c.meta.landmarks.midlineX);
  const refLine = surface === 'posterior' || surface === 'posterolateral' ? 'spinous processes' : 'midline (sternum)';

  // needle angle from vertical, measured in the axial plane for the chosen position
  const ax: Vec3 = norm([outward[0], outward[1], 0]);
  const angle = deg(Math.acos(Math.max(-1, Math.min(1, dot(ax, up)))));
  const medialTip = (a.entry[0] - c.meta.landmarks.midlineX) * (a.dir[0]) < 0;
  const dirWord = medialTip ? 'medially (toward the midline)' : 'laterally';
  const angleText =
    angle < 4
      ? 'straight down (vertical)'
      : angle <= 60
        ? `${angle.toFixed(0)}° from vertical, tip directed ${dirWord}`
        : `near-horizontal insertion, ${Math.abs(90 - angle).toFixed(0)}° from the horizontal, tip directed ${dirWord}`;

  const tilt = a.tiltDeg;
  const tiltText =
    tilt < 3
      ? 'in the axial plane (no gantry tilt needed)'
      : `${tilt.toFixed(0)}° ${a.dir[2] < 0 ? 'caudal' : 'cranial'} angulation (tip toward the ${a.dir[2] < 0 ? 'feet' : 'head'})${tilt > 15 ? ' — out-of-plane, needs gantry tilt or a double-oblique approach' : ''}`;

  const depthToLesion = a.lesionDepthMm ?? a.totalMm;
  const lengthCm = [10, 15, 20].find((l) => l * 10 >= depthToLesion + 15) ?? 20;
  const needleText = `${lengthCm} cm coaxial introducer (lesion edge at ${(depthToLesion / 10).toFixed(1)} cm, centre at ${(a.totalMm / 10).toFixed(1)} cm)`;

  const base =
    position === 'supine'
      ? 'Supine (on the back)'
      : position === 'prone'
        ? 'Prone (face down), arms raised above the head to rotate the scapulae laterally'
        : position === 'left lateral decubitus'
          ? 'Left lateral decubitus (lying on the left side)'
          : 'Right lateral decubitus (lying on the right side)';
  const positionText =
    choice.kind === 'sideDown'
      ? `${base} — biopsy side down, which lowered pneumothorax in Drumm 2019; ${outward[1] > 0 ? 'prone' : 'supine'} is the conventional alternative`
      : choice.kind === 'sideUp'
        ? `${base} — biopsied lung uppermost (higher-risk position, forced by the lateral entry)`
        : base;

  return {
    position,
    positionText,
    upVector: up,
    side,
    surface,
    entryText: `${side[0].toUpperCase() + side.slice(1)} ${surface} chest wall, ${icsText}, ${(fromMidline / 10).toFixed(1)} cm from the ${refLine}`,
    ribAbove: above?.name ?? null,
    ribBelow: below?.name ?? null,
    icsText,
    fromMidlineMm: fromMidline,
    tableZmm: a.entry[2],
    targetZmm: a.target[2],
    angleFromVerticalDeg: angle,
    angleText,
    tiltDeg: tilt,
    tiltText,
    needleText,
  };
}
