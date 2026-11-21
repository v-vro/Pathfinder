// One Euro filter (Casiez et al., CHI 2012): low lag when moving fast, low jitter when still.
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  constructor(minCutoff = 1.0, beta = 0.01, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tMs: number): number {
    if (this.x === null || this.t === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.t) / 1000, 1e-3);
    this.t = tMs;
    const dxRaw = (value - this.x) / dt;
    this.dx = this.dx + this.alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = this.x + this.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.t = null;
  }
}
