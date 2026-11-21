import { useEffect, useRef } from 'react';
import type { CaseData } from '../engine/loadCase';
import type { PathAnalysis } from '../engine/pathAnalysis';
import { L, type Vec3 } from '../engine/types';
import { cross, dot, norm, scale, sub, add } from '../engine/vec';

export type SliceMode = 'needle' | 'axial';
export type CtWindow = 'lung' | 'soft';

const WINDOWS: Record<CtWindow, { c: number; w: number }> = {
  lung: { c: -600, w: 1500 },
  soft: { c: 40, w: 400 },
};

interface Props {
  data: CaseData;
  path: PathAnalysis | null;
  target: Vec3;
  mode: SliceMode;
  win: CtWindow;
  overlay: boolean;
  size?: number;
}

/** Plane basis: origin + right * u + down * v (mm). Radiological convention: patient right on image left. */
function planeFor(mode: SliceMode, target: Vec3, path: PathAnalysis | null) {
  const X: Vec3 = [1, 0, 0];
  const Y: Vec3 = [0, 1, 0];
  const Z: Vec3 = [0, 0, 1];
  let n: Vec3 = Z;
  if (mode === 'needle' && path) {
    const d = path.dir;
    const zp = sub(Z, scale(d, dot(Z, d)));
    if (Math.hypot(...zp) > 0.05) n = norm(zp);
    else n = norm(sub(Y, scale(d, dot(Y, d)))); // needle almost vertical -> coronal-ish
  }
  let right = sub(X, scale(n, dot(X, n)));
  if (Math.hypot(...right) < 0.1) right = sub(Y, scale(n, dot(Y, n)));
  right = norm(right);
  let down = norm(cross(n, right));
  if (dot(down, Y) < 0 && Math.abs(dot(n, Z)) > 0.5) down = scale(down, -1);
  if (Math.abs(dot(n, Z)) <= 0.5 && dot(down, Z) > 0) down = scale(down, -1); // coronal: head up
  let centre: Vec3 = target;
  let fov = 150;
  if (path) {
    centre = scale(add(path.entry, path.target), 0.5);
    if (mode === 'axial') centre = [centre[0], centre[1], target[2]];
    fov = Math.max(130, path.totalMm * 1.35);
  }
  return { n, right, down, centre, fov };
}

export function SliceView({ data, path, target, mode, win, overlay, size = 360 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => draw());
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, path, mode, win, overlay, size, target]);

  function draw() {
    const cv = ref.current;
    if (!cv) return;
    const N = size;
    cv.width = N;
    cv.height = N;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    const { right, down, centre, fov } = planeFor(mode, target, path);
    const mmpp = fov / N;
    const { c: wc, w: ww } = WINDOWS[win];
    const lo = wc - ww / 2;
    const { ct, labels, vclear, emph } = data;
    const px = img.data;
    for (let j = 0; j < N; j++) {
      const v = (j - N / 2) * mmpp;
      for (let i = 0; i < N; i++) {
        const u = (i - N / 2) * mmpp;
        const x = centre[0] + right[0] * u + down[0] * v;
        const y = centre[1] + right[1] * u + down[1] * v;
        const z = centre[2] + right[2] * u + down[2] * v;
        const hu = ct.linear(x, y, z);
        let g = ((hu - lo) / ww) * 255;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        let r = g;
        let gg = g;
        let b = g;
        if (overlay) {
          const lab = labels.nearest(x, y, z);
          if (lab === L.NODULE) {
            r = r * 0.55 + 255 * 0.45;
            gg = gg * 0.55 + 160 * 0.45;
            b = b * 0.55;
          } else if (lab >= 10 && lab <= 14) {
            if (vclear.nearest(x, y, z) === 0) {
              r = r * 0.45 + 255 * 0.55;
              gg *= 0.45;
              b = b * 0.45 + 80 * 0.55;
            } else {
              const e = emph.nearest(x, y, z);
              if (e >= 15) {
                const a = e === 200 ? 0.5 : 0.3;
                r = r * (1 - a) + 178 * a;
                gg = gg * (1 - a) + 107 * a;
                b = b * (1 - a) + 255 * a;
              }
            }
          }
        }
        const o = (j * N + i) * 4;
        px[o] = r;
        px[o + 1] = gg;
        px[o + 2] = b;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const toPx = (p: Vec3) => {
      const d = sub(p, centre);
      return { x: N / 2 + dot(d, right) / mmpp, y: N / 2 + dot(d, down) / mmpp };
    };
    // target
    const tp = toPx(target);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, (data.meta.target.diameterMm / 2 + 3) / mmpp, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (path) {
      const e = toPx(path.entry);
      const t = toPx(path.target);
      const col = path.feasible ? '#ffffff' : '#8a8a8a';
      // hub extension
      const hub = toPx(add(path.entry, scale(path.dir, -30)));
      ctx.strokeStyle = 'rgba(148,163,184,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash(mode === 'axial' && path.tiltDeg > 3 ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const dot_ = (p: Vec3, color: string, r = 3.5) => {
        const q = toPx(p);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      if (path.pleuraPoint) dot_(path.pleuraPoint, '#ffffff');
      for (const f of path.fissures) dot_(f.at, '#22d3ee', 4);
      for (const v of path.vesselsCrossed) dot_(v.at, '#ff4d6d', 3);
      for (const b of path.blockers) if (b.kind !== 'length') dot_(b.at, '#ff2bd6', 5);
      // depth labels
      ctx.font = '600 12px "Public Sans", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(5,8,13,0.7)';
      const lbl = `${(path.totalMm / 10).toFixed(1)} cm`;
      const mid = { x: (e.x + t.x) / 2, y: (e.y + t.y) / 2 };
      const tw = ctx.measureText(lbl).width;
      ctx.fillRect(mid.x + 8, mid.y - 9, tw + 8, 16);
      ctx.fillStyle = '#e6f6ff';
      ctx.fillText(lbl, mid.x + 12, mid.y + 3);
    }

    // orientation + scale bar
    ctx.font = '600 12px "Public Sans", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(230,246,255,0.75)';
    ctx.fillText('R', 6, N / 2 + 4);
    ctx.fillText('L', N - 13, N / 2 + 4);
    const sb = 20 / mmpp;
    ctx.fillRect(N - sb - 10, N - 14, sb, 2);
    ctx.fillText('2 cm', N - sb - 10, N - 20);

  }

  return <canvas ref={ref} className="slice-canvas" style={{ width: size, height: size }} />;
}
