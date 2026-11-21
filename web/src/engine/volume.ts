import type { GridInfo, Vec3 } from './types';

type Arr = Uint8Array | Int16Array;

/** An axis-aligned scalar volume in LPS mm with nearest / trilinear sampling. */
export class Volume<T extends Arr = Arr> {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly sp: number;
  readonly inv: number;
  readonly data: T;
  readonly outside: number;

  constructor(grid: GridInfo, data: T, outside = 0) {
    [this.nx, this.ny, this.nz] = grid.dims;
    [this.ox, this.oy, this.oz] = grid.origin;
    this.sp = grid.spacing;
    this.inv = 1 / grid.spacing;
    this.data = data;
    this.outside = outside;
    const expected = this.nx * this.ny * this.nz;
    if (data.length !== expected) throw new Error(`volume size mismatch: ${data.length} vs ${expected}`);
  }

  nearest(x: number, y: number, z: number): number {
    const i = Math.round((x - this.ox) * this.inv);
    const j = Math.round((y - this.oy) * this.inv);
    const k = Math.round((z - this.oz) * this.inv);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return this.outside;
    return this.data[(k * this.ny + j) * this.nx + i];
  }

  linear(x: number, y: number, z: number): number {
    const fx = (x - this.ox) * this.inv;
    const fy = (y - this.oy) * this.inv;
    const fz = (z - this.oz) * this.inv;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx - 1 || j >= this.ny - 1 || k >= this.nz - 1) return this.outside;
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const nx = this.nx;
    const nxy = this.nx * this.ny;
    const d = this.data;
    const b = k * nxy + j * nx + i;
    const c000 = d[b];
    const c100 = d[b + 1];
    const c010 = d[b + nx];
    const c110 = d[b + nx + 1];
    const c001 = d[b + nxy];
    const c101 = d[b + nxy + 1];
    const c011 = d[b + nxy + nx];
    const c111 = d[b + nxy + nx + 1];
    const c00 = c000 + (c100 - c000) * tx;
    const c10 = c010 + (c110 - c010) * tx;
    const c01 = c001 + (c101 - c001) * tx;
    const c11 = c011 + (c111 - c011) * tx;
    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  }

  /** Central-difference gradient of the trilinear field (per mm). */
  gradient(x: number, y: number, z: number, h = this.sp): Vec3 {
    return [
      (this.linear(x + h, y, z) - this.linear(x - h, y, z)) / (2 * h),
      (this.linear(x, y + h, z) - this.linear(x, y - h, z)) / (2 * h),
      (this.linear(x, y, z + h) - this.linear(x, y, z - h)) / (2 * h),
    ];
  }

  get bounds(): { min: Vec3; max: Vec3 } {
    return {
      min: [this.ox, this.oy, this.oz],
      max: [this.ox + (this.nx - 1) * this.sp, this.oy + (this.ny - 1) * this.sp, this.oz + (this.nz - 1) * this.sp],
    };
  }
}
