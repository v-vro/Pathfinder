import { useEffect, useRef } from 'react';

/** Wordmark glyph: Vitruvian circle and square, crossed by the needle's path. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden fill="none" stroke="currentColor" strokeWidth="1">
      <circle cx="16" cy="16" r="13.5" />
      <rect x="6.5" y="6.5" width="19" height="19" />
      <path d="M3 29 L21 11" strokeWidth="1.4" />
      <circle cx="21" cy="11" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Ordered-dither (Bayer 4x4) study of a lung cross-section, used only while loading. */
export function DitherLoader() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const N = 96;
    cv.width = N;
    cv.height = N;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    let raf = 0;
    const draw = (t: number) => {
      const ph = t * 0.0012;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const u = (x - N / 2) / (N / 2);
          const v = (y - N / 2) / (N / 2);
          // body ellipse, two darker lungs, a scanning line
          const body = Math.hypot(u / 0.95, v / 0.72) < 1 ? 0.7 : 0;
          const lung = Math.hypot((Math.abs(u) - 0.42) / 0.3, v / 0.48) < 1 ? 0.55 : 0;
          const scan = Math.max(0, 1 - Math.abs(v - Math.sin(ph) * 0.8) * 9) * 0.35;
          const g = Math.min(1, body - lung + scan + 0.08 * Math.sin(u * 9 + ph * 2) * (lung > 0 ? 1 : 0));
          const on = g > BAYER[(y & 3) * 4 + (x & 3)];
          const o = (y * N + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = on ? 235 : 0;
          img.data[o + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-hidden />;
}

/** ASCII bar: risk on a 0–50 % scale, with the typical rate marked. */
export function Meter({ value, typical, max = 0.5, cells = 24 }: { value: number; typical: number; max?: number; cells?: number }) {
  const n = Math.round(Math.min(1, value / max) * cells);
  const t = Math.round(Math.min(1, typical / max) * cells);
  const chars = Array.from({ length: cells }, (_, i) => (i < n ? '█' : i === t ? '|' : '·'));
  return (
    <p className="meter" aria-hidden>
      {chars.slice(0, n).join('')}
      <span>{chars.slice(n).join('')}</span>
    </p>
  );
}
