import { Volume } from './volume';
import type { CaseMeta } from './types';

export interface CaseData {
  meta: CaseMeta;
  base: string;
  labels: Volume<Uint8Array>;
  vclear: Volume<Uint8Array>; // mm*4 to nearest vessel wall
  vcal: Volume<Uint8Array>; // mm*10 calibre of that vessel
  vclearL: Volume<Uint8Array>; // mm*4 to nearest large (>=4 mm) vessel
  emph: Volume<Uint8Array>; // LAA-950 %, 200 = bulla
  lung: Volume<Uint8Array>; // 0..255 smoothed lung mask
  ct: Volume<Int16Array>; // HU, 1 mm grid
  lines: CenterLines | null;
  fmaj: Volume<Uint8Array> | null; // mm*4 to the predicted major fissures
  fmin: Volume<Uint8Array> | null; // mm*4 to the predicted minor fissure
  vsl: Volume<Uint8Array> | null; // 1 artery, 2 vein, 3 airway lumen
}

/** Vessel / airway centrelines: per point (x, y, z, radiusMm, flowMm); branches [kind, start, count]. */
export interface CenterLines {
  pts: Float32Array;
  branches: [number, number, number][];
  kinds: string[];
}

async function fetchBytes(url: string, onProgress?: (n: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let buf = await res.arrayBuffer();
  onProgress?.(buf.byteLength);
  const u8 = new Uint8Array(buf, 0, 2);
  // Some servers transparently gunzip; only decompress if the gzip magic is still there.
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = await new Response(ds).arrayBuffer();
  }
  return buf;
}

export async function loadCase(caseId: string, onStatus?: (s: string) => void): Promise<CaseData> {
  const base = `/cases/${caseId}/`;
  onStatus?.('Loading case metadata');
  const meta: CaseMeta = await (await fetch(base + 'meta.json')).json();
  const f = meta.files;
  onStatus?.('Loading anatomy volumes');
  const [labels, vclear, vcal, vclearL, emph, lung, ct] = await Promise.all([
    fetchBytes(base + f.labels),
    fetchBytes(base + f.vclear),
    fetchBytes(base + f.vcal),
    fetchBytes(base + f.vclearL),
    fetchBytes(base + f.emph),
    fetchBytes(base + f.lung),
    fetchBytes(base + f.ct),
  ]);
  let lines: CenterLines | null = null;
  if (f.lines && f.linesIndex) {
    try {
      const [buf, idx] = await Promise.all([fetchBytes(base + f.lines), fetch(base + f.linesIndex).then((r) => r.json())]);
      lines = { pts: new Float32Array(buf), branches: idx.branches, kinds: idx.kinds };
    } catch (e) {
      console.warn('no centrelines', e);
    }
  }
  const optional = async (name?: string) => (name ? fetchBytes(base + name).then((b) => new Uint8Array(b)).catch(() => null) : null);
  const [fmaj, fmin, vsl] = await Promise.all([optional(f.fmaj), optional(f.fmin), optional(f.vsl)]);
  onStatus?.('Building volumes');
  return {
    meta,
    base,
    labels: new Volume(meta.grid, new Uint8Array(labels), 0),
    vclear: new Volume(meta.grid, new Uint8Array(vclear), 255),
    vcal: new Volume(meta.grid, new Uint8Array(vcal), 0),
    vclearL: new Volume(meta.grid, new Uint8Array(vclearL), 255),
    emph: new Volume(meta.grid, new Uint8Array(emph), 0),
    lung: new Volume(meta.grid, new Uint8Array(lung), 0),
    ct: new Volume(meta.ctGrid, new Int16Array(ct), -1024),
    lines,
    fmaj: fmaj ? new Volume(meta.grid, fmaj, 255) : null,
    fmin: fmin ? new Volume(meta.grid, fmin, 255) : null,
    vsl: vsl ? new Volume(meta.grid, vsl, 0) : null,
  };
}
