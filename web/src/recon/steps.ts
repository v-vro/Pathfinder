// The reconstruction, step by step: method, reliability, what to check.
import type { CaseMeta } from '../engine/types';
import type { Overlay, Plane } from './CtPanel';
import { PART_COLORS } from './ReconViewer';

export interface LegendItem {
  name: string;
  color: string;
  meshes: string[];
  code?: number; // overlay class it corresponds to
}

export interface Step {
  id: string;
  title: string;
  how: string;
  accuracy: string;
  check: string;
  plane: Plane;
  at: 'nodule' | 'mid' | 'spine';
  win: 'lung' | 'soft';
  overlay: Overlay;
  legend: LegendItem[];
  stats: (m: CaseMeta) => [string, string][];
}

const lobes: LegendItem[] = [
  { name: 'Right upper', color: PART_COLORS.lung_upper_lobe_right, meshes: ['lung_upper_lobe_right'], code: 12 },
  { name: 'Right middle', color: PART_COLORS.lung_middle_lobe_right, meshes: ['lung_middle_lobe_right'], code: 13 },
  { name: 'Right lower', color: PART_COLORS.lung_lower_lobe_right, meshes: ['lung_lower_lobe_right'], code: 14 },
  { name: 'Left upper', color: PART_COLORS.lung_upper_lobe_left, meshes: ['lung_upper_lobe_left'], code: 10 },
  { name: 'Left lower', color: PART_COLORS.lung_lower_lobe_left, meshes: ['lung_lower_lobe_left'], code: 11 },
];

export const STEPS: Step[] = [
  {
    id: 'body',
    title: 'Body',
    how: 'Threshold at −500 HU; largest connected region.',
    accuracy: 'Reliable. The right flank falls outside the 360 mm scan field: no data there, so it is excluded from planning.',
    check: 'Outline sits on the skin.',
    plane: 'axial',
    at: 'mid',
    win: 'soft',
    overlay: {
      source: 'body',
      classes: [
        { code: 1, name: 'Body', color: '#e0b48f' },
        { code: 15, name: 'Outside scan field', color: '#a26bff' },
      ],
    },
    legend: [
      { name: 'Body', color: '#e0b48f', meshes: ['skin'], code: 1 },
      { name: 'Outside scan field', color: '#a26bff', meshes: [], code: 15 },
    ],
    stats: (m) => [
      ['Volume', `${(m.scan?.size as number[] | undefined)?.join(' × ') ?? '?'}`],
      ['Slice', `${(m.scan?.spacingMm as number[] | undefined)?.[2] ?? '?'} mm`],
      ['Field', `${m.scan?.reconstructionDiameter ? Number(m.scan.reconstructionDiameter).toFixed(0) : '?'} mm`],
      ['Body', `${m.summary?.bodyLitres ?? '?'} L`],
      ['Outside field', `${m.summary?.synthesizedMl ?? '?'} mL`],
    ],
  },
  {
    id: 'skeleton',
    title: 'Skeleton',
    how: 'TotalSegmentator labels each bone; edges snapped to >160 HU.',
    accuracy: 'High. Dice ≈0.94 on its training sites, lower elsewhere.',
    check: 'Count the ribs; the plan names the interspace.',
    plane: 'coronal',
    at: 'spine',
    win: 'soft',
    overlay: {
      source: 'labels',
      classes: [
        { code: 2, name: 'Ribs', color: PART_COLORS.ribs },
        { code: 9, name: 'Sternum, clavicles', color: '#f5d68a' },
        { code: 8, name: 'Spine', color: PART_COLORS.spine },
        { code: 7, name: 'Scapulae', color: PART_COLORS.scapulae },
      ],
    },
    legend: [
      { name: 'Ribs', color: PART_COLORS.ribs, meshes: ['ribs'], code: 2 },
      { name: 'Sternum, clavicles', color: '#f5d68a', meshes: ['ribs'], code: 9 },
      { name: 'Spine', color: PART_COLORS.spine, meshes: ['spine'], code: 8 },
      { name: 'Scapulae', color: PART_COLORS.scapulae, meshes: ['scapulae'], code: 7 },
    ],
    stats: (m) => [
      ['Ribs', `${m.summary?.ribsFound.length ?? '?'} / 24`],
      ['Spine', m.summary ? sortVert(m.summary.vertebraeFound) : '?'],
    ],
  },
  {
    id: 'lungs',
    title: 'Lungs',
    how: 'TotalSegmentator lobes, edges snapped to air. Fissures are where lobes meet.',
    accuracy: 'Lobes good. Fissures are the weakest step: 5–10 mm error, often incomplete. Near-misses are flagged.',
    check: 'Borders follow the visible fissure lines.',
    plane: 'sagittal',
    at: 'nodule',
    win: 'lung',
    overlay: { source: 'labels', classes: lobes.map((l) => ({ code: l.code!, name: l.name, color: l.color })) },
    legend: [
      ...lobes,
      { name: 'Fissures', color: PART_COLORS.right_oblique_fissure, meshes: ['right_oblique_fissure', 'right_horizontal_fissure', 'left_oblique_fissure'] },
    ],
    stats: (m) => Object.entries(m.stats.lobeVolumesMl).map(([k, v]) => [cap(k.replace(' lobe', '')), `${v} mL`] as [string, string]),
  },
  {
    id: 'mediastinum',
    title: 'Heart & airway',
    how: 'TotalSegmentator: heart, great vessels, trachea. No-go zones.',
    accuracy: 'Good. Walls are softer without contrast.',
    check: 'Outlines follow the mediastinum.',
    plane: 'axial',
    at: 'mid',
    win: 'soft',
    overlay: {
      source: 'labels',
      classes: [
        { code: 3, name: 'Heart', color: PART_COLORS.heart },
        { code: 4, name: 'Great vessels', color: PART_COLORS.great_vessels },
        { code: 5, name: 'Trachea', color: PART_COLORS.airways },
      ],
    },
    legend: [
      { name: 'Heart', color: PART_COLORS.heart, meshes: ['heart'], code: 3 },
      { name: 'Great vessels', color: PART_COLORS.great_vessels, meshes: ['great_vessels'], code: 4 },
      { name: 'Trachea', color: PART_COLORS.airways, meshes: [], code: 5 },
    ],
    stats: (m) => [['Heart', `${m.summary?.heartMl ?? '?'} mL`]],
  },
  {
    id: 'vessels',
    title: 'Vessels',
    how: 'TotalSegmentator lung_vessels: arteries, veins, airways.',
    accuracy: 'Dice ≈0.95 on training data, ≈0.8 elsewhere. Artery vs vein ≈90%, so not used for risk. 2 mm margin.',
    check: 'Bright branches are coloured.',
    plane: 'axial',
    at: 'nodule',
    win: 'lung',
    overlay: {
      source: 'vsl',
      classes: [
        { code: 1, name: 'Arteries', color: PART_COLORS.arteries },
        { code: 2, name: 'Veins', color: PART_COLORS.veins },
        { code: 3, name: 'Airways', color: PART_COLORS.airways },
      ],
    },
    legend: [
      { name: 'Arteries', color: PART_COLORS.arteries, meshes: ['arteries'], code: 1 },
      { name: 'Veins', color: PART_COLORS.veins, meshes: ['veins'], code: 2 },
      { name: 'Airways', color: PART_COLORS.airways, meshes: ['airways'], code: 3 },
    ],
    stats: (m) => [
      ['Arteries', `${m.summary?.branches.arteries ?? '?'} branches`],
      ['Veins', `${m.summary?.branches.veins ?? '?'} branches`],
      ['Airways', `${m.summary?.branches.airways ?? '?'} branches`],
    ],
  },
  {
    id: 'nodule',
    title: 'Nodule',
    how: 'Radiologist-marked centre; region-grown above −650 HU.',
    accuracy: 'Location: expert. Margin: approximate.',
    check: 'Covers the nodule, not the vessels.',
    plane: 'axial',
    at: 'nodule',
    win: 'lung',
    overlay: { source: 'labels', classes: [{ code: 20, name: 'Nodule', color: PART_COLORS.nodule }] },
    legend: [{ name: 'Nodule', color: PART_COLORS.nodule, meshes: ['nodule'], code: 20 }],
    stats: (m) => [
      ['Diameter', `${m.target.diameterMm} mm`],
      ['Volume', `${m.target.volumeMl} mL`],
      ['Density', `${m.target.meanHU} HU`],
      ['To pleura', `${m.target.pleuraDistanceMm} mm`],
    ],
  },
  {
    id: 'emphysema',
    title: 'Emphysema',
    how: 'LAA-950: lung voxels below −950 HU.',
    accuracy: 'Standard measure, ± a few %. Under 6% is not significant.',
    check: 'Marked areas look darker than normal lung.',
    plane: 'axial',
    at: 'nodule',
    win: 'lung',
    overlay: {
      source: 'emph',
      classes: [
        { code: 15, name: 'Emphysema', color: '#a26bff' },
        { code: 200, name: 'Bulla', color: '#ff6bd5' },
      ],
    },
    legend: [
      { name: 'Emphysema', color: '#a26bff', meshes: ['emphysema'], code: 15 },
      { name: 'Bulla', color: '#ff6bd5', meshes: [], code: 200 },
    ],
    stats: (m) => [
      ['LAA-950', `${m.stats.laa950Pct}%`],
      ['Bullae', `${m.stats.bullaVolumeMl} mL`],
    ],
  },
];

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sortVert(v: string[]) {
  const order = (s: string) => ({ C: 0, T: 100, L: 200 }[s[0]] ?? 300) + parseInt(s.slice(1), 10);
  const s = [...v].sort((a, b) => order(a) - order(b));
  return s.length ? `${s[0]}–${s[s.length - 1]}` : '?';
}
