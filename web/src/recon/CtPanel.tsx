// A CT view (axial / coronal / sagittal) drawn straight from the voxel volume, with colour-matched
// segmentation overlays (fill + contour), hover / click picking and a crosshair.
import { useEffect, useRef } from 'react';
import type { CaseData } from '../engine/loadCase';
import type { Vec3 } from '../engine/types';

export type Plane = 'axial' | 'coronal' | 'sagittal';
export type Source = 'labels' | 'vsl' | 'emph' | 'fissure' | 'body' | 'none';

export interface OverlayClass {
  code: number;
  name: string;
  color: string;
}

export interface Overlay {
  source: Source;
  classes: OverlayClass[];
}

interface Props {
  data: CaseData;
  plane: Plane;
  point: Vec3; // the slice passes through this point
  overlay?: Overlay;
  highlight?: number | null;
  win?: 'lung' | 'soft';
  crosshair?: boolean;
  onPick?: (p: Vec3) => void;
  onHover?: (p: Vec3 | null, code: number) => void;
  onCanvas?: (c: HTMLCanvasElement) => void;
  className?: string;
}

const WIN = { lung: [-600, 1500], soft: [40, 420] } as const;

/** Pixel -> LPS point mapping for each plane (radiological display: patient right on the left, head up). */
export function planeGeometry(d: CaseData, plane: Plane) {
  const g = d.meta.ctGrid;
  const [nx, ny, nz] = g.dims;
  const [ox, oy, oz] = g.origin;
  const sp = g.spacing;
  const z1 = oz + (nz - 1) * sp;
  if (plane === 'axial') return { w: nx, h: ny, at: (i: number, j: number, p: Vec3): Vec3 => [ox + i * sp, oy + j * sp, p[2]] };
  if (plane === 'coronal') return { w: nx, h: nz, at: (i: number, j: number, p: Vec3): Vec3 => [ox + i * sp, p[1], z1 - j * sp] };
  return { w: ny, h: nz, at: (i: number, j: number, p: Vec3): Vec3 => [p[0], oy + i * sp, z1 - j * sp] };
}

export function toPixel(d: CaseData, plane: Plane, p: Vec3) {
  const g = d.meta.ctGrid;
  const [ox, oy, oz] = g.origin;
  const sp = g.spacing;
  const z1 = oz + (g.dims[2] - 1) * sp;
  if (plane === 'axial') return { i: (p[0] - ox) / sp, j: (p[1] - oy) / sp };
  if (plane === 'coronal') return { i: (p[0] - ox) / sp, j: (z1 - p[2]) / sp };
  return { i: (p[1] - oy) / sp, j: (z1 - p[2]) / sp };
}

export function codeAt(d: CaseData, src: Source, x: number, y: number, z: number): number {
  switch (src) {
    case 'labels':
      return d.labels.nearest(x, y, z);
    case 'vsl':
      return d.vsl ? d.vsl.nearest(x, y, z) : 0;
    case 'emph': {
      if (!(d.labels.nearest(x, y, z) >= 10 && d.labels.nearest(x, y, z) <= 14)) return 0;
      const e = d.emph.nearest(x, y, z);
      return e === 200 ? 200 : e >= 15 ? 15 : 0;
    }
    case 'fissure': {
      const l = d.labels.nearest(x, y, z);
      if (!(l >= 10 && l <= 14)) return 0;
      if (d.fmin && d.fmin.linear(x, y, z) / 4 < 1.1) return 2;
      if (d.fmaj && d.fmaj.linear(x, y, z) / 4 < 1.1) return 1;
      return 0;
    }
    case 'body': {
      const l = d.labels.nearest(x, y, z);
      return l === 15 ? 15 : l > 0 ? 1 : 0;
    }
    default:
      return 0;
  }
}

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function CtPanel({ data, plane, point, overlay, highlight = null, win = 'lung', crosshair = true, onPick, onHover, onCanvas, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geo = planeGeometry(data, plane);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const { w, h, at } = geo;
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const px = img.data;
    const [c, ww] = WIN[win];
    const lo = c - ww / 2;
    const ct = data.ct;
    const src = overlay?.source ?? 'none';
    const colors = new Map<number, [number, number, number]>();
    for (const k of overlay?.classes ?? []) colors.set(k.code, hexRgb(k.color));
    const codes = new Int32Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const p = at(i, j, point);
        const hu = ct.nearest(p[0], p[1], p[2]);
        let g = ((hu - lo) / ww) * 255;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        const o = (j * w + i) * 4;
        px[o] = px[o + 1] = px[o + 2] = g;
        px[o + 3] = 255;
        if (src !== 'none') {
          const code = codeAt(data, src, p[0], p[1], p[2]);
          codes[j * w + i] = colors.has(code) ? code : 0;
        }
      }
    if (src !== 'none') {
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const k = codes[j * w + i];
          if (!k) continue;
          const edge =
            (i > 0 && codes[j * w + i - 1] !== k) ||
            (i < w - 1 && codes[j * w + i + 1] !== k) ||
            (j > 0 && codes[(j - 1) * w + i] !== k) ||
            (j < h - 1 && codes[(j + 1) * w + i] !== k);
          const [r, gg, b] = colors.get(k)!;
          const a = edge ? 0.95 : highlight === null ? 0.3 : highlight === k ? 0.55 : 0.1;
          const o = (j * w + i) * 4;
          px[o] = px[o] * (1 - a) + r * a;
          px[o + 1] = px[o + 1] * (1 - a) + gg * a;
          px[o + 2] = px[o + 2] * (1 - a) + b * a;
        }
    }
    ctx.putImageData(img, 0, 0);
    if (crosshair) {
      const q = toPixel(data, plane, point);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(q.i, 0);
      ctx.lineTo(q.i, h);
      ctx.moveTo(0, q.j);
      ctx.lineTo(w, q.j);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    onCanvas?.(cv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plane, point[0], point[1], point[2], overlay, highlight, win, crosshair]);

  const toLPS = (e: React.MouseEvent): Vec3 => {
    const r = ref.current!.getBoundingClientRect();
    const i = ((e.clientX - r.left) / r.width) * geo.w;
    const j = ((e.clientY - r.top) / r.height) * geo.h;
    return geo.at(i, j, point);
  };

  return (
    <canvas
      ref={ref}
      className={className ?? 'ct-canvas'}
      style={{ aspectRatio: `${geo.w} / ${geo.h}` }}
      onClick={(e) => onPick?.(toLPS(e))}
      onMouseMove={(e) => {
        if (!onHover) return;
        const p = toLPS(e);
        onHover(p, overlay ? codeAt(data, overlay.source, p[0], p[1], p[2]) : 0);
      }}
      onMouseLeave={() => onHover?.(null, 0)}
    />
  );
}
