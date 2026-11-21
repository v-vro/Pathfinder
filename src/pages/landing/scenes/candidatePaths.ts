import * as THREE from "three";
import { RISK_WORD, riskIconSvg, type RiskLevel } from "../../../components/riskIcons";

/**
 * Decorative "candidate path" loop for the landing hero.
 *
 * Straight lines run from random points on the chest surface (between two ribs) to one
 * target inside a lung. Each draws in, holds, then fades; 3-5 are visible at once. They
 * live on an overlay camera layer, so <DitherCanvas> draws them crisp and undithered on
 * top of the 1-bit anatomy, and they are children of the model, so they rotate with it.
 * Each has an HTML label (icon + word + short reason) projected to its entry point.
 *
 * The risk colours and reasons are illustrative only, not computed.
 */

const REASONS: Record<RiskLevel, string[]> = {
  safe: ["clear rib gap", "short lung path"],
  caution: ["near vessel", "steep angle", "long lung path"],
  danger: ["crosses fissure", "blocked by rib", "through emphysema"],
};

const DRAW_S = 0.8;
const FADE_S = 0.6;
const MIN_VISIBLE = 3;
const MAX_VISIBLE = 5;
const POOL = 8;
const TUBE_RADIUS = 0.0045;

export interface RibCurve {
  curve: THREE.CatmullRomCurve3;
  side: number;
}

interface Path {
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  dot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  label: HTMLDivElement;
  entry: THREE.Vector3;
  normal: THREE.Vector3;
  risk: RiskLevel;
  age: number;
  hold: number;
  active: boolean;
  /** Label width in px, measured once per spawn. */
  labelWidth: number;
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function pickRisk(): RiskLevel {
  // Mostly caution or danger; an occasional safe one stands out.
  const r = Math.random();
  return r < 0.17 ? "safe" : r < 0.58 ? "caution" : "danger";
}

function readRiskColours(): Record<RiskLevel, THREE.Color> {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    new THREE.Color(css.getPropertyValue(name).trim() || fallback);
  return {
    safe: get("--risk-safe", "#22c55e"),
    caution: get("--risk-caution", "#eab308"),
    danger: get("--risk-danger", "#ef4444"),
  };
}

export interface CandidatePathsOptions {
  /** The model group; paths are added as its children. */
  parent: THREE.Object3D;
  ribs: RibCurve[];
  /** Target inside a lung, in the parent's local space. */
  target: THREE.Vector3;
  /** Element the labels are appended to (positioned over the canvas). */
  labelLayer: HTMLElement;
  /** Camera layer drawn as an undithered overlay. */
  layer: number;
  reducedMotion: boolean;
}

export class CandidatePaths {
  private readonly opts: CandidatePathsOptions;
  private readonly colours = readRiskColours();
  private readonly paths: Path[] = [];
  private readonly targetDot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly targetHalo: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private spawnTimer = 0;
  /** From the previous frame: paths on screen and not fading / all paths on screen. */
  private showing = 0;
  private present = 0;
  private started = false;
  private readonly gaps: { a: THREE.CatmullRomCurve3; b: THREE.CatmullRomCurve3 }[] = [];

  // Scratch
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();

  constructor(opts: CandidatePathsOptions) {
    this.opts = opts;

    // Rib gaps: consecutive ribs on the same side (skip the very top and bottom).
    for (const side of [-1, 1]) {
      const ribs = opts.ribs.filter((r) => r.side === side);
      for (let i = 1; i < ribs.length - 2; i++) {
        this.gaps.push({ a: ribs[i].curve, b: ribs[i + 1].curve });
      }
    }

    this.targetDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthTest: false }),
    );
    this.targetHalo = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        fog: false,
        transparent: true,
        opacity: 0.25,
        depthTest: false,
        depthWrite: false,
      }),
    );
    for (const m of [this.targetDot, this.targetHalo]) {
      m.position.copy(opts.target);
      m.layers.set(opts.layer);
      m.renderOrder = 3;
      opts.parent.add(m);
    }

    for (let i = 0; i < POOL; i++) this.paths.push(this.createPath());
  }

  private createPath(): Path {
    const material = new THREE.MeshBasicMaterial({
      fog: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(), material);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), material);
    for (const m of [mesh, dot]) {
      m.layers.set(this.opts.layer);
      m.renderOrder = 2;
      m.visible = false;
      this.opts.parent.add(m);
    }
    const label = document.createElement("div");
    label.className = "lp-path-label";
    label.style.opacity = "0";
    this.opts.labelLayer.appendChild(label);
    return {
      mesh,
      dot,
      label,
      entry: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      risk: "caution",
      age: 0,
      hold: 0,
      active: false,
      labelWidth: 0,
    };
  }

  /** Facing factor (0 = edge-on or behind, 1 = facing the camera) for a local point/normal. */
  private facing(entry: THREE.Vector3, normal: THREE.Vector3, camera: THREE.Camera): number {
    const m = this.opts.parent.matrixWorld;
    this.v.copy(entry).applyMatrix4(m);
    this.n.copy(normal).transformDirection(m);
    this.toCam.copy(camera.position).sub(this.v).normalize();
    return this.n.dot(this.toCam);
  }

  /** Pick an entry between two ribs, preferring points that face the camera. */
  private chooseEntry(camera: THREE.Camera, out: THREE.Vector3, normal: THREE.Vector3): void {
    let best = -Infinity;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let attempt = 0; attempt < 14; attempt++) {
      const gap = pick(this.gaps);
      const f = 0.2 + Math.random() * 0.72; // along the rib, back (0) to front (1)
      p.copy(gap.a.getPoint(f)).lerp(gap.b.getPoint(f), 0.5);
      n.set(p.x, 0, p.z + 0.05).normalize(); // outward from the body axis
      p.addScaledVector(n, 0.05); // skin sits just outside the ribs
      let score = this.facing(p, n, camera);
      // Keep entries apart so labels don't stack.
      for (const other of this.paths) {
        if (other.active && other.entry.distanceTo(p) < 0.35) score -= 1;
      }
      if (score > best) {
        best = score;
        out.copy(p);
        normal.copy(n);
      }
      if (score > 0.45) break;
    }
  }

  private spawn(camera: THREE.Camera, startAge = 0): void {
    const path = this.paths.find((p) => !p.active);
    if (!path) return;
    this.chooseEntry(camera, path.entry, path.normal);
    path.risk = pickRisk();
    path.age = startAge;
    path.hold = 2 + Math.random();
    path.active = true;

    path.mesh.geometry.dispose();
    path.mesh.geometry = new THREE.TubeGeometry(
      new THREE.LineCurve3(path.entry.clone(), this.opts.target.clone()),
      48,
      TUBE_RADIUS,
      6,
      false,
    );
    path.mesh.material.color.copy(this.colours[path.risk]);
    path.dot.position.copy(path.entry);
    path.label.className = `lp-path-label lp-path-label--${path.risk}`;
    path.label.innerHTML =
      riskIconSvg(path.risk, "lp-path-label__icon") +
      `<span class="lp-path-label__risk">${RISK_WORD[path.risk]}</span>` +
      `<span class="lp-path-label__reason">· ${pick(REASONS[path.risk])}</span>`;
    path.labelWidth = path.label.offsetWidth;
  }

  /** Static set for reduced motion: four paths, fully drawn, no loop. */
  private spawnStatic(camera: THREE.Camera): void {
    const risks: RiskLevel[] = ["danger", "caution", "safe", "caution"];
    for (const risk of risks) {
      this.spawn(camera);
      const path = this.paths.filter((p) => p.active).at(-1);
      if (!path) continue;
      path.risk = risk;
      path.age = DRAW_S;
      path.hold = Infinity;
      path.mesh.material.color.copy(this.colours[risk]);
      path.label.className = `lp-path-label lp-path-label--${risk}`;
      path.label.innerHTML =
        riskIconSvg(risk, "lp-path-label__icon") +
        `<span class="lp-path-label__risk">${RISK_WORD[risk]}</span>` +
        `<span class="lp-path-label__reason">· ${REASONS[risk][0]}</span>`;
      path.labelWidth = path.label.offsetWidth;
    }
  }

  /**
   * Advance the loop and position labels. Call after the parent's matrixWorld is current.
   * `width`/`height` are the canvas size in CSS pixels.
   */
  update(dt: number, time: number, camera: THREE.Camera, width: number, height: number): void {
    const { reducedMotion } = this.opts;

    if (!this.started) {
      this.started = true;
      if (reducedMotion) this.spawnStatic(camera);
      else for (let i = 0; i < MIN_VISIBLE; i++) this.spawn(camera, -i * 0.45);
    }

    if (!reducedMotion) {
      this.spawnTimer -= dt;
      // Count what is actually on screen, so paths hidden at the back don't hold slots.
      const room = this.present < MAX_VISIBLE;
      if (room && (this.showing < MIN_VISIBLE || this.spawnTimer <= 0)) {
        this.spawn(camera);
        this.spawnTimer = 0.8 + Math.random() * 0.5;
      }
    }

    // Target pulse.
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3.2);
    this.targetDot.scale.setScalar(1 + pulse * 0.25);
    this.targetHalo.scale.setScalar(1.6 + pulse * 1.4);
    this.targetHalo.material.opacity = 0.32 * (1 - pulse * 0.6);

    // Body centre on screen, for pushing labels outward.
    this.centre.setFromMatrixPosition(this.opts.parent.matrixWorld).project(camera);
    const cx = (this.centre.x * 0.5 + 0.5) * width;
    const cy = (-this.centre.y * 0.5 + 0.5) * height;

    let showing = 0;
    let present = 0;
    for (const path of this.paths) {
      if (!path.active) continue;
      if (!reducedMotion) path.age += dt;
      const age = path.age;
      const end = DRAW_S + path.hold + FADE_S;
      if (age >= end) {
        path.active = false;
        path.mesh.visible = path.dot.visible = false;
        path.label.style.opacity = "0";
        continue;
      }
      if (age < 0) {
        // Waiting for its staggered start: counts as on screen so we don't over-spawn.
        showing++;
        present++;
        path.mesh.visible = path.dot.visible = false;
        path.label.style.opacity = "0";
        continue;
      }

      const draw = Math.min(age / DRAW_S, 1);
      const fade = age > DRAW_S + path.hold ? 1 - (age - DRAW_S - path.hold) / FADE_S : 1;
      // Hide paths (and labels) whose entry has turned to the back of the model.
      const facing = THREE.MathUtils.smoothstep(
        this.facing(path.entry, path.normal, camera),
        -0.05,
        0.3,
      );
      const alpha = fade * facing;
      if (age < DRAW_S + path.hold && facing > 0.5) showing++;
      if (alpha > 0.05) present++;

      const count = path.mesh.geometry.index?.count ?? 0;
      path.mesh.geometry.setDrawRange(0, Math.floor((count * draw) / 6) * 6);
      path.mesh.material.opacity = alpha;
      path.mesh.visible = path.dot.visible = alpha > 0.01;

      // Label at the entry point, nudged outward from the body centre.
      this.v.copy(path.entry).applyMatrix4(this.opts.parent.matrixWorld).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      let dx = x - cx;
      let dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      // Keep the label inside the canvas.
      const left = dx < 0;
      const lx = left
        ? Math.max(x + dx * 14, path.labelWidth + 4)
        : Math.min(x + dx * 14, width - path.labelWidth - 4);
      const ly = THREE.MathUtils.clamp(y + dy * 10, 12, height - 12);
      const labelAlpha = Math.min(age / 0.35, 1) * alpha;
      path.label.style.opacity = labelAlpha.toFixed(3);
      path.label.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(${left ? "-100%" : "0"}, -50%)`;
    }
    this.showing = showing;
    this.present = present;
  }

  dispose(): void {
    for (const path of this.paths) {
      path.mesh.geometry.dispose();
      path.dot.geometry.dispose();
      path.mesh.material.dispose();
      path.label.remove();
    }
    this.targetDot.geometry.dispose();
    this.targetDot.material.dispose();
    this.targetHalo.geometry.dispose();
    this.targetHalo.material.dispose();
  }
}
