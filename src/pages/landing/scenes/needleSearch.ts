import * as THREE from "three";
import { RISK_WORD, riskIconSvg, type RiskLevel } from "../../../components/riskIcons";

/**
 * Decorative "needle search" for the landing hero.
 *
 * One attempt at a time: a monochrome biopsy needle appears outside the chest, lined up
 * on a straight path to the target, advances (slowing as it pierces the skin), leaving a
 * thin grey track. When it stops, the track takes its risk colour and a label appears at
 * the entry point. It holds, pulls back out and fades; the track and label linger, then
 * the track stays faintly as search history. A sequence is 2-3 failed attempts (caution,
 * danger, or blocked by a rib) and then a safe one, after which it restarts.
 *
 * Everything lives on an overlay camera layer, so <DitherCanvas> draws it crisp on top of
 * the 1-bit anatomy, and is parented to the model, so it rotates with it.
 * Outcomes, colours and reasons are illustrative only, not computed.
 */

type Outcome = "safe" | "caution" | "danger" | "blocked";

const REASONS: Record<Exclude<Outcome, "blocked">, string[]> = {
  safe: ["clear rib gap", "short lung path"],
  caution: ["near vessel", "steep angle", "long lung path"],
  danger: ["crosses fissure", "through emphysema"],
};

const LEVEL: Record<Outcome, RiskLevel> = {
  safe: "safe",
  caution: "caution",
  danger: "danger",
  blocked: "danger",
};

// Needle geometry (scene units; the ribcage is ~2.2 wide).
const NEEDLE_LENGTH = 0.5;
const SHAFT_RADIUS = 0.0065;
const BEVEL_LENGTH = 0.045;
const TRACK_RADIUS = 0.005;
/** How far outside the skin the needle tip starts. */
const START_OUTSIDE = 0.3;

// Timing (seconds).
const APPEAR = 0.3;
const ADVANCE_SPEED = 0.62; // units/s before slow-downs; most attempts take ~1-1.5 s
const HOLD = 1.5;
const HOLD_SAFE = 2.6;
const WITHDRAW = 0.8;
const LINGER = 0.7;
const FADE = 0.6;
const GAP = 0.35;

const HISTORY = 2;
const HISTORY_OPACITY = 0.28;

type Phase = "appear" | "advance" | "hold" | "withdraw" | "linger" | "fade";

interface Track {
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  skin: THREE.Vector3;
  normal: THREE.Vector3;
  opacity: number;
  dying: boolean;
}

interface Attempt {
  outcome: Outcome;
  start: THREE.Vector3;
  skin: THREE.Vector3;
  stop: THREE.Vector3;
  normal: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  skinDistance: number;
  track: Track;
  label: HTMLDivElement;
  labelWidth: number;
  phase: Phase;
  t: number;
  d: number;
  labelAlpha: number;
}

export interface RibCurve {
  curve: THREE.CatmullRomCurve3;
  side: number;
}

export interface NeedleSearchOptions {
  /** The model group; everything is added as its children. */
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

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function readColour(css: CSSStyleDeclaration, name: string, fallback: string) {
  return new THREE.Color(css.getPropertyValue(name).trim() || fallback);
}

/** Needle pointing along +Y with its tip at the origin; shaft and hub extend along -Y. */
function buildNeedle(material: THREE.Material): THREE.Group {
  const group = new THREE.Group();

  const shaft = new THREE.CylinderGeometry(
    SHAFT_RADIUS,
    SHAFT_RADIUS,
    NEEDLE_LENGTH - BEVEL_LENGTH,
    12,
  );
  shaft.translate(0, -BEVEL_LENGTH - (NEEDLE_LENGTH - BEVEL_LENGTH) / 2, 0);

  // Bevelled tip: a short cylinder whose top is cut at an angle down to a sharp point.
  const bevel = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, BEVEL_LENGTH, 12, 1);
  const pos = bevel.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      const x = pos.getX(i);
      pos.setY(i, BEVEL_LENGTH / 2 - ((x + SHAFT_RADIUS) / (2 * SHAFT_RADIUS)) * BEVEL_LENGTH);
    }
  }
  bevel.translate(0, -BEVEL_LENGTH / 2, 0);
  bevel.computeVertexNormals();

  const collar = new THREE.CylinderGeometry(0.011, 0.011, 0.03, 16);
  collar.translate(0, -NEEDLE_LENGTH + 0.015, 0);
  const hub = new THREE.CylinderGeometry(0.017, 0.021, 0.07, 18);
  hub.translate(0, -NEEDLE_LENGTH - 0.035, 0);

  for (const g of [shaft, bevel, collar, hub]) group.add(new THREE.Mesh(g, material));
  return group;
}

export class NeedleSearch {
  private readonly opts: NeedleSearchOptions;
  private readonly risk: Record<RiskLevel, THREE.Color>;
  private readonly grey: THREE.Color;
  private readonly needle: THREE.Group;
  private readonly needleMaterial: THREE.MeshStandardMaterial;
  private readonly targetDot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly targetHalo: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly gaps: { a: THREE.CatmullRomCurve3; b: THREE.CatmullRomCurve3 }[] = [];
  private readonly ribsBySide: THREE.CatmullRomCurve3[][] = [];

  private queue: Outcome[] = [];
  private current: Attempt | null = null;
  private history: Track[] = [];
  private wait = 0.4;
  private hitTime = -10;
  private elapsed = 0;
  private staticDone = false;

  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(opts: NeedleSearchOptions) {
    this.opts = opts;
    const css = getComputedStyle(document.documentElement);
    this.risk = {
      safe: readColour(css, "--risk-safe", "#22c55e"),
      caution: readColour(css, "--risk-caution", "#eab308"),
      danger: readColour(css, "--risk-danger", "#ef4444"),
    };
    this.grey = readColour(css, "--color-text-muted", "#8a8a8a");

    for (const side of [-1, 1]) {
      const ribs = opts.ribs.filter((r) => r.side === side).map((r) => r.curve);
      this.ribsBySide.push(ribs.slice(1, -1));
      for (let i = 1; i < ribs.length - 2; i++) this.gaps.push({ a: ribs[i], b: ribs[i + 1] });
    }

    this.needleMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8e8e8,
      roughness: 0.35,
      metalness: 0.2,
      fog: false,
      transparent: true,
      opacity: 0,
    });
    this.needle = buildNeedle(this.needleMaterial);
    this.needle.visible = false;
    this.addToOverlay(this.needle, 4);

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
      this.addToOverlay(m, 5);
    }
  }

  private addToOverlay(obj: THREE.Object3D, order: number) {
    obj.traverse((o) => {
      o.layers.set(this.opts.layer);
      o.renderOrder = order;
    });
    this.opts.parent.add(obj);
  }

  /** How much a local point/normal faces the camera (1 = straight at it, <0 = away). */
  private facing(point: THREE.Vector3, normal: THREE.Vector3, camera: THREE.Camera): number {
    const m = this.opts.parent.matrixWorld;
    this.v.copy(point).applyMatrix4(m);
    this.n.copy(normal).transformDirection(m);
    this.toCam.copy(camera.position).sub(this.v).normalize();
    return this.n.dot(this.toCam);
  }

  /** Facing after the model turns a further `angle` radians about the vertical axis. */
  private facingAfterSpin(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    camera: THREE.Camera,
    angle: number,
  ): number {
    const m = this.opts.parent.matrixWorld;
    const p = point.clone().applyMatrix4(m).applyAxisAngle(this.up, angle);
    const n = normal.clone().transformDirection(m).applyAxisAngle(this.up, angle);
    return n.dot(camera.position.clone().sub(p).normalize());
  }

  /** 0 when the entry point has turned behind the model, 1 when it is clearly in view. */
  private visibility(point: THREE.Vector3, normal: THREE.Vector3, camera: THREE.Camera) {
    return THREE.MathUtils.smoothstep(this.facing(point, normal, camera), -0.2, 0.12);
  }

  private newSequence() {
    const fails = Math.random() < 0.5 ? 2 : 3;
    this.queue = [];
    for (let i = 0; i < fails; i++) {
      const r = Math.random();
      this.queue.push(r < 0.35 ? "caution" : r < 0.68 ? "blocked" : "danger");
    }
    this.queue.push("safe");
  }

  /** Choose skin entry + stop point, preferring entries that face the camera. */
  private plan(outcome: Outcome, camera: THREE.Camera) {
    const target = this.opts.target;
    let best: { skin: THREE.Vector3; normal: THREE.Vector3; rib: THREE.Vector3 | null } | null =
      null;
    let bestScore = -Infinity;
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const dirWorld = new THREE.Vector3();
    for (let attempt = 0; attempt < 24; attempt++) {
      const f = 0.25 + Math.random() * 0.65; // along the rib, back (0) to front (1)
      let base: THREE.Vector3;
      let rib: THREE.Vector3 | null = null;
      if (outcome === "blocked") {
        rib = pick(pick(this.ribsBySide)).getPoint(f);
        base = rib.clone();
      } else {
        const gap = pick(this.gaps);
        base = gap.a.getPoint(f).lerp(gap.b.getPoint(f), 0.5);
      }
      const normal = new THREE.Vector3(base.x, 0, base.z + 0.05).normalize();
      const skin = base.clone().addScaledVector(normal, 0.06);
      // The entry must be on the visible side now and after the idle spin carries the
      // model round during the attempt (it rotates about +Y).
      const facingNow = this.facing(skin, normal, camera);
      const facingLater = this.facingAfterSpin(skin, normal, camera, 0.7);
      let score = Math.min(facingNow, facingLater) < 0.1 ? -3 : 0;
      // ...and the path should run across the screen, not straight into it.
      dirWorld.copy(target).sub(skin).normalize().transformDirection(this.opts.parent.matrixWorld);
      score += 1.2 * (1 - Math.abs(dirWorld.dot(forward)));
      // Plausible approaches: near the target's height, on the target's side of the chest.
      score -= Math.max(0, Math.abs(skin.y - target.y) - 0.35) * 1.5;
      if (Math.sign(skin.x) !== Math.sign(target.x)) score -= 0.6;
      for (const h of this.history) if (h.skin.distanceTo(skin) < 0.3) score -= 0.8;
      score += Math.random() * 0.25; // variety
      if (score > bestScore) {
        bestScore = score;
        best = { skin, normal, rib };
      }
    }
    const { skin, normal, rib } = best!;
    const dir = target.clone().sub(skin).normalize();
    // Blocked: stop on the rib surface just under the skin. Otherwise: at the target.
    const stop = rib ? skin.clone().addScaledVector(dir, 0.025) : target.clone();
    const start = skin.clone().addScaledVector(dir, -START_OUTSIDE);
    return { skin, normal, dir, stop, start, visible: bestScore > -1 };
  }

  private makeLabel(outcome: Outcome): { el: HTMLDivElement; width: number } {
    const level = LEVEL[outcome];
    const el = document.createElement("div");
    el.className = `lp-path-label lp-path-label--${level}`;
    el.style.opacity = "0";
    el.innerHTML =
      outcome === "blocked"
        ? riskIconSvg(level, "lp-path-label__icon") +
          `<span class="lp-path-label__risk">Blocked by rib</span>`
        : riskIconSvg(level, "lp-path-label__icon") +
          `<span class="lp-path-label__risk">${RISK_WORD[level]}</span>` +
          `<span class="lp-path-label__reason">· ${pick(REASONS[outcome])}</span>`;
    this.opts.labelLayer.appendChild(el);
    return { el, width: el.offsetWidth };
  }

  private makeTrack(
    start: THREE.Vector3,
    stop: THREE.Vector3,
    skin: THREE.Vector3,
    normal: THREE.Vector3,
  ): Track {
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.LineCurve3(start, stop), 64, TRACK_RADIUS, 6, false),
      new THREE.MeshBasicMaterial({ color: this.grey, fog: false, transparent: true }),
    );
    mesh.geometry.setDrawRange(0, 0);
    this.addToOverlay(mesh, 3);
    return { mesh, skin, normal, opacity: 1, dying: false };
  }

  private startAttempt(camera: THREE.Camera) {
    if (this.queue.length === 0) this.newSequence();
    const outcome = this.queue.shift()!;
    const p = this.plan(outcome, camera);
    if (!p.visible) {
      // Nothing usable faces the camera right now (e.g. mid-spin): try again shortly.
      this.queue.unshift(outcome);
      this.wait = 0.3;
      return;
    }
    const { el, width } = this.makeLabel(outcome);
    this.current = {
      outcome,
      start: p.start,
      skin: p.skin,
      stop: p.stop,
      normal: p.normal,
      dir: p.dir,
      length: p.start.distanceTo(p.stop),
      skinDistance: START_OUTSIDE,
      track: this.makeTrack(p.start, p.stop, p.skin, p.normal),
      label: el,
      labelWidth: width,
      phase: "appear",
      t: 0,
      d: 0,
      labelAlpha: 0,
    };
    this.needle.quaternion.setFromUnitVectors(this.up, p.dir);
  }

  /** Reduced motion: one static safe track with its label, no needle, no loop. */
  private showStatic(camera: THREE.Camera) {
    const p = this.plan("safe", camera);
    const { el, width } = this.makeLabel("safe");
    const track = this.makeTrack(p.start, p.stop, p.skin, p.normal);
    track.mesh.geometry.setDrawRange(0, Infinity);
    track.mesh.material.color.copy(this.risk.safe);
    this.current = {
      outcome: "safe",
      start: p.start,
      skin: p.skin,
      stop: p.stop,
      normal: p.normal,
      dir: p.dir,
      length: p.start.distanceTo(p.stop),
      skinDistance: START_OUTSIDE,
      track,
      label: el,
      labelWidth: width,
      phase: "hold",
      t: 0,
      d: 0,
      labelAlpha: 1,
    };
  }

  private retire(track: Track) {
    this.history.push(track);
    // Keep only the last few faint tracks.
    const alive = this.history.filter((h) => !h.dying);
    if (alive.length > HISTORY) alive[0].dying = true;
  }

  private disposeTrack(track: Track) {
    track.mesh.removeFromParent();
    track.mesh.geometry.dispose();
    track.mesh.material.dispose();
  }

  /** Advance the animation and position the label. Call after the parent's matrixWorld is current. */
  update(dt: number, camera: THREE.Camera, width: number, height: number): void {
    this.elapsed += dt;

    if (this.opts.reducedMotion) {
      if (!this.staticDone) {
        this.staticDone = true;
        this.showStatic(camera);
      }
      this.targetDot.scale.setScalar(1.15);
      this.targetHalo.scale.setScalar(2.2);
      const a = this.current!;
      const vis = this.visibility(a.skin, a.normal, camera);
      a.track.mesh.material.opacity = vis;
      this.placeLabel(a, vis, camera, width, height);
      return;
    }

    if (!this.current) {
      this.wait -= dt;
      if (this.wait <= 0) this.startAttempt(camera);
    }

    let a = this.current;
    // If the entry turns out of view before the needle stops, cancel and re-run this
    // attempt from a visible spot, so the search sequence is never shown half-hidden.
    if (a && (a.phase === "appear" || a.phase === "advance")) {
      if (this.visibility(a.skin, a.normal, camera) < 0.15) {
        this.queue.unshift(a.outcome);
        a.label.remove();
        this.disposeTrack(a.track);
        this.needle.visible = false;
        this.current = a = null;
        this.wait = 0.2;
      }
    }
    if (a) this.step(a, dt);

    // History tracks: faint, fading out when dropped.
    for (const h of this.history) {
      const goal = h.dying ? 0 : HISTORY_OPACITY;
      h.opacity += (goal - h.opacity) * (1 - Math.exp(-dt * 4));
      h.mesh.material.opacity = h.opacity * this.visibility(h.skin, h.normal, camera);
    }
    for (const h of this.history.filter((x) => x.dying && x.opacity < 0.01)) {
      this.disposeTrack(h);
    }
    this.history = this.history.filter((x) => !(x.dying && x.opacity < 0.01));

    // Target: gentle pulse, strong pulse after a safe hit.
    const sinceHit = this.elapsed - this.hitTime;
    const hit = sinceHit < 2.2 ? Math.max(0, Math.sin(sinceHit * 9)) * (1 - sinceHit / 2.2) : 0;
    const idle = 0.5 + 0.5 * Math.sin(this.elapsed * 3);
    this.targetDot.scale.setScalar(1 + idle * 0.15 + hit * 0.8);
    this.targetHalo.scale.setScalar(1.6 + idle * 0.8 + hit * 3);
    this.targetHalo.material.opacity = 0.2 + hit * 0.35;

    if (a) {
      const vis = this.visibility(a.skin, a.normal, camera);
      this.needleMaterial.opacity *= vis;
      a.track.mesh.material.opacity *= vis;
      this.placeLabel(a, a.labelAlpha * vis, camera, width, height);
    }
  }

  private step(a: Attempt, dt: number) {
    a.t += dt;
    let needleOpacity = 1;
    let trackOpacity = 1;
    let labelAlpha = 0;

    switch (a.phase) {
      case "appear":
        needleOpacity = Math.min(a.t / APPEAR, 1);
        if (a.t >= APPEAR) this.next(a, "advance");
        break;
      case "advance": {
        // Ease in from rest, slow down as the tip pierces the skin and near the end.
        const fromSkin = Math.abs(a.d - a.skinDistance);
        const skinDip = 1 - 0.45 * Math.max(0, 1 - fromSkin / 0.08);
        const ease = Math.min(1, 0.25 + a.t / 0.25);
        const end = THREE.MathUtils.clamp((a.length - a.d) / 0.15, 0.3, 1);
        a.d = Math.min(a.length, a.d + ADVANCE_SPEED * skinDip * ease * end * dt);
        if (a.d >= a.length - 1e-4) {
          a.d = a.length;
          a.track.mesh.material.color.copy(this.risk[LEVEL[a.outcome]]);
          if (a.outcome === "safe") this.hitTime = this.elapsed;
          this.next(a, "hold");
        }
        break;
      }
      case "hold":
        labelAlpha = Math.min(a.t / 0.3, 1);
        if (a.t >= (a.outcome === "safe" ? HOLD_SAFE : HOLD)) this.next(a, "withdraw");
        break;
      case "withdraw": {
        const x = Math.min(a.t / WITHDRAW, 1);
        a.d = a.length - (a.length + 0.15) * x * x;
        needleOpacity = 1 - Math.pow(x, 1.5);
        labelAlpha = 1;
        if (x >= 1) this.next(a, "linger");
        break;
      }
      case "linger":
        needleOpacity = 0;
        labelAlpha = 1;
        if (a.t >= LINGER) this.next(a, "fade");
        break;
      case "fade": {
        const x = Math.min(a.t / FADE, 1);
        needleOpacity = 0;
        labelAlpha = 1 - x;
        trackOpacity = 1 - (1 - HISTORY_OPACITY) * x;
        if (x >= 1) this.finish(a);
        break;
      }
    }

    // Needle: tip at distance d along the line.
    this.needle.visible = needleOpacity > 0.01;
    this.needle.position.copy(a.start).addScaledVector(a.dir, a.d);
    this.needleMaterial.opacity = needleOpacity;

    // Track: the stretch travelled so far (full once it has stopped).
    const reached = a.phase === "appear" ? 0 : a.phase === "advance" ? a.d / a.length : 1;
    const count = a.track.mesh.geometry.index?.count ?? 0;
    a.track.mesh.geometry.setDrawRange(0, Math.floor((count * reached) / 6) * 6);
    a.track.mesh.material.opacity = trackOpacity;
    a.labelAlpha = labelAlpha;
  }

  private next(a: Attempt, phase: Phase) {
    a.phase = phase;
    a.t = 0;
  }

  private finish(a: Attempt) {
    a.label.remove();
    a.track.opacity = HISTORY_OPACITY;
    this.retire(a.track);
    this.current = null;
    this.needle.visible = false;
    this.wait = GAP;
    // After the safe attempt, clear the search history and start a new sequence.
    if (a.outcome === "safe") {
      for (const h of this.history) h.dying = true;
      this.wait = GAP + 0.6;
    }
  }

  private placeLabel(
    a: Attempt,
    alpha: number,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    this.centre.setFromMatrixPosition(this.opts.parent.matrixWorld).project(camera);
    const cx = (this.centre.x * 0.5 + 0.5) * width;
    const cy = (-this.centre.y * 0.5 + 0.5) * height;
    this.v.copy(a.skin).applyMatrix4(this.opts.parent.matrixWorld).project(camera);
    const x = (this.v.x * 0.5 + 0.5) * width;
    const y = (-this.v.y * 0.5 + 0.5) * height;
    let dx = x - cx;
    let dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Nudge outward from the body and keep the label inside the canvas.
    const left = dx < 0;
    const lx = left
      ? Math.max(x + dx * 16, a.labelWidth + 4)
      : Math.min(x + dx * 16, width - a.labelWidth - 4);
    const ly = THREE.MathUtils.clamp(y + dy * 12, 12, height - 12);
    a.label.style.opacity = alpha.toFixed(3);
    a.label.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(${left ? "-100%" : "0"}, -50%)`;
  }

  dispose(): void {
    if (this.current) {
      this.current.label.remove();
      this.disposeTrack(this.current.track);
    }
    for (const h of this.history) this.disposeTrack(h);
    this.needle.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.needleMaterial.dispose();
    this.targetDot.geometry.dispose();
    this.targetDot.material.dispose();
    this.targetHalo.geometry.dispose();
    this.targetHalo.material.dispose();
  }
}
