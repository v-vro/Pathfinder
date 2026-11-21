// Shared types for the Pathfinder engine. All coordinates are DICOM patient coordinates (LPS, mm):
// +x = patient's left, +y = posterior, +z = superior (head).

export type Vec3 = [number, number, number];

export interface GridInfo {
  origin: Vec3;
  spacing: number;
  dims: [number, number, number]; // nx, ny, nz  (arrays are z-major: idx = (k*ny + j)*nx + i)
}

export interface CaseMeta {
  caseId: string;
  source: string;
  series: string;
  grid: GridInfo;
  ctGrid: GridInfo;
  files: Record<'labels' | 'vclear' | 'vcal' | 'vclearL' | 'emph' | 'lung' | 'ct' | 'anatomy' | 'lines' | 'linesIndex' | 'fmaj' | 'fmin' | 'vsl', string>;
  scan?: Record<string, string | number | number[]>;
  summary?: {
    ribsFound: string[];
    vertebraeFound: string[];
    heartMl: number;
    arteriesMl: number;
    veinsMl: number;
    airwayMl: number;
    branches: Record<string, number>;
    synthesizedMl: number;
    bodyLitres: number;
  };
  body?: { floorZ: number; headTopZ: number; shoulderZ: number; torsoZ: [number, number]; midlineX: number };
  labels: Record<string, string>;
  target: {
    center: Vec3;
    centroid: Vec3;
    diameterMm: number;
    volumeMl: number;
    meanHU: number;
    lobe: string;
    lobeLabel: number;
    pleuraDistanceMm: number | null;
  };
  landmarks: { midlineX: number; spinePosteriorY: number | null; sternumAnteriorY: number | null };
  ribs: Record<string, Vec3[]>;
  stats: {
    laa950Pct: number;
    bullaVolumeMl: number;
    lobeVolumesMl: Record<string, number>;
    vesselSource: string;
    segmentation: string;
  };
}

/** Label values written by pipeline/build_case.py */
export const L = {
  OUTSIDE: 0,
  SOFT: 1,
  RIB: 2,
  HEART: 3,
  GREAT_VESSEL: 4,
  AIRWAY: 5,
  ABDOMEN: 6,
  SCAPULA: 7,
  SPINE: 8,
  OTHER_BONE: 9,
  LUL: 10,
  LLL: 11,
  RUL: 12,
  RML: 13,
  RLL: 14,
  SYNTH: 15, // outside the scanner's field of view (body shape mirrored, no image data)
  NODULE: 20,
} as const;

export const isLobe = (l: number) => l >= 10 && l <= 14;
export const isLung = (l: number) => isLobe(l) || l === L.NODULE;
export const isBone = (l: number) => l === L.RIB || l === L.SCAPULA || l === L.SPINE || l === L.OTHER_BONE;
export const isForbiddenOrgan = (l: number) =>
  l === L.HEART || l === L.GREAT_VESSEL || l === L.AIRWAY || l === L.ABDOMEN;

export const LOBE_NAMES: Record<number, string> = {
  10: 'left upper lobe',
  11: 'left lower lobe',
  12: 'right upper lobe',
  13: 'right middle lobe',
  14: 'right lower lobe',
};

export function fissureName(a: number, b: number): string {
  const s = [a, b].sort().join('-');
  switch (s) {
    case '12-14':
    case '13-14':
      return 'right major (oblique) fissure';
    case '12-13':
      return 'right minor (horizontal) fissure';
    case '10-11':
      return 'left major (oblique) fissure';
    default:
      return 'interlobar fissure';
  }
}
