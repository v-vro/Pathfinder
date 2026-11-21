import * as THREE from "three";
import { RISK_WORD, riskIconSvg, type RiskLevel } from "../../../components/riskIcons";

/**
 * Decorative "needle search" for the landing hero.
 *
 * One attempt at a time: a blue (--needle) biopsy needle appears outside the chest, lined
 * up on a straight path to the target, and advances (slowing as it pierces the skin),
 * leaving a thin grey track. When it stops, the track takes its risk colour and a label
 * appears at the entry point. It holds, pulls back out and fades, while the next attempt
 * starts and the old track and label fade into faint search history. A sequence is 2-3
 * failed attempts (caution, danger, or blocked by a rib) and then a safe one (~5-6 s).
 *
 * Everything lives on an overlay camera layer, so <DitherCanvas> draws it crisp on top of
 * the 1-bit anatomy, and is parented to the model, so it rotates with it. Risk colours are
 * only ever on the track, never on the needle.
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
/** Target on-screen shaft thickness in CSS px; the needle is scaled up to reach it. */
const SHAFT_PX = 3;
/** How far outside the skin the needle tip starts. */
const START_OUTSIDE = 0.3;

// Timing (seconds). One failed attempt ≈ 1.75 s, the safe one ≈ 2.25 s.
const INSERT = 0.55; // full-length insertion; shorter travel (blocked) is quicker
const FADE_IN = 0.1;
const HOLD = 0.65;
const HOLD_SAFE = 0.95;
const WITHDRAW = 0.35;
const GAP = 0.2;
const GAP_RESTART = 0.4;
// Track + label after the needle has gone (runs alongside the next attempt).
const LINGER = 0.2;
const FADE = 0.35;

const HISTORY = 2;
const HISTORY_OPACITY = 0.28;

type Phase = "advance" | "hold" | "withdraw";

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
  /** Advance speed scale so the insertion takes the planned time. */
  speed: number;
  track: Track;
  label: HTMLDivElement;
  labelWidth: number;
  phase: Phase;
  t: number;
  d: number;
  labelAlpha: number;
}

/** An attempt whose needle is gone: its track and label linger, then fade. */
interface Fading {
  attempt: Attempt;
  t: number;
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

const smooth = THREE.MathUtils.smoothstep;

/** Relative speed along the path: eases in, dips as the tip pierces the skin, eases out. */
function speedProfile(d: number, length: number): number {
  const easeIn = 0.35 + 0.65 * smooth(d, 0, 0.08);
  const skin = 1 - 0.4 * Math.max(0, 1 - Math.abs(d - START_OUTSIDE) / 0.06);
  const easeOut = 0.35 + 0.65 * smooth(length - d, 0, 0.12);
  return easeIn * skin * easeOut;
}

/** Speed scale that makes the insertion over `length` take `seconds`. */
function speedFor(length: number, seconds: number): number {
  // time = ∫ dd / (k · profile(d))  →  k = ∫ dd / profile(d) / seconds
  const steps = 120;
  let integral = 0;
  for (let i = 0; i < steps; i++) {
    const d = ((i + 0.5) / steps) * length;
    integral += length / steps / speedProfile(d, length);
  }
  return integral / seconds;
}

/** Soft glow around the shaft: brightest facing the camera, fading to nothing at the edges. */
function glowMaterial(colour: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: colour.clone() }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float f = pow(abs(dot(normalize(vNormal), normalize(vView))), 3.0);
        gl_FragColor = vec4(uColor * f * uOpacity, 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}

interface NeedleParts {
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  glow: THREE.ShaderMaterial;
  tipGlow: THREE.SpriteMaterial;
}

/** Needle pointing along +Y with its tip at the origin; shaft and hub extend along -Y. */
function buildNeedle(colour: THREE.Color): NeedleParts {
  const group = new THREE.Group();

  // Metal rod in the needle colour; a little emissive so the shaded side stays vivid.
  const body = new THREE.MeshStandardMaterial({
    color: colour,
    emissive: colour.clone().multiplyScalar(0.35),
    metalness: 0.55,
    roughness: 0.28,
    fog: false,
    transparent: true,
  });
  // Slightly brighter tip.
  const tipColour = colour.clone().lerp(new THREE.Color(0xffffff), 0.45);
  const tip = new THREE.MeshStandardMaterial({
    color: tipColour,
    emissive: tipColour.clone().multiplyScalar(0.6),
    metalness: 0.5,
    roughness: 0.22,
    fog: false,
    transparent: true,
  });

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

  group.add(new THREE.Mesh(shaft, body), new THREE.Mesh(bevel, tip));
  group.add(new THREE.Mesh(collar, body), new THREE.Mesh(hub, body));

  // Glow sleeve along the shaft, plus a small soft glow at the tip.
  const glow = glowMaterial(colour);
  const sleeve = new THREE.CylinderGeometry(
    SHAFT_RADIUS * 4,
    SHAFT_RADIUS * 4,
    NEEDLE_LENGTH,
    16,
    1,
    true,
  );
  sleeve.translate(0, -NEEDLE_LENGTH / 2, 0);
  const sleeveMesh = new THREE.Mesh(sleeve, glow);
  sleeveMesh.renderOrder = -1;
  group.add(sleeveMesh);

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.4, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tipGlow = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    color: tipColour,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(tipGlow);
  sprite.scale.setScalar(0.06);
  group.add(sprite);

  return { group, materials: [body, tip], glow, tipGlow };
}

export class NeedleSearch {
  private readonly opts: NeedleSearchOptions;
  private readonly risk: Record<RiskLevel, THREE.Color>;
  private readonly grey: THREE.Color;
  private readonly needle: NeedleParts;
  private readonly targetDot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly targetHalo: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly gaps: { a: THREE.CatmullRomCurve3; b: THREE.CatmullRomCurve3 }[] = [];
  private readonly ribsBySide: THREE.CatmullRomCurve3[][] = [];

  private queue: Outcome[] = [];
  private current: Attempt | null = null;
  private fading: Fading[] = [];
  private history: Track[] = [];
  private wait = 0.3;
  private hitTime = -10;
  private elapsed = 0;
  private staticAttempt: Attempt | null = null;

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

    this.needle = buildNeedle(readColour(css, "--needle", "#3b82f6"));
    this.needle.group.visible = false;
    this.addToOverlay(this.needle.group, 4);

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
      if (o.renderOrder === 0) o.renderOrder = order;
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
    return smooth(this.facing(point, normal, camera), -0.2, 0.12);
  }

  private newSequence() {
    const fails = Math.random() < 0.7 ? 2 : 3;
    this.queue = [];
    for (let i = 0; i < fails; i++) {
      const r = Math.random();
      this.queue.push(r < 0.35 ? "caution" : r < 0.68 ? "blocked" : "danger");
    }
    this.queue.push("safe");
  }

  /** Choose skin entry + stop point that will be clearly visible on screen. */
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
      const facingLater = this.facingAfterSpin(skin, normal, camera, 0.4);
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

  private createAttempt(outcome: Outcome, p: ReturnType<NeedleSearch["plan"]>): Attempt {
    const { el, width } = this.makeLabel(outcome);
    const length = p.start.distanceTo(p.stop);
    // Full insertions take INSERT seconds; short ones (blocked at a rib) are quicker.
    const seconds = INSERT * THREE.MathUtils.clamp(length / 0.8, 0.55, 1);
    return {
      outcome,
      start: p.start,
      skin: p.skin,
      stop: p.stop,
      normal: p.normal,
      dir: p.dir,
      length,
      speed: speedFor(length, seconds),
      track: this.makeTrack(p.start, p.stop, p.skin, p.normal),
      label: el,
      labelWidth: width,
      phase: "advance",
      t: 0,
      d: 0,
      labelAlpha: 0,
    };
  }

  private startAttempt(camera: THREE.Camera) {
    if (this.queue.length === 0) this.newSequence();
    const outcome = this.queue.shift()!;
    const p = this.plan(outcome, camera);
    if (!p.visible) {
      // Nothing usable faces the camera right now (e.g. mid-spin): try again shortly.
      this.queue.unshift(outcome);
      this.wait = 0.2;
      return;
    }
    this.current = this.createAttempt(outcome, p);
    this.needle.group.quaternion.setFromUnitVectors(this.up, p.dir);
  }

  private retire(track: Track) {
    track.opacity = HISTORY_OPACITY;
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

  private setNeedleOpacity(opacity: number) {
    for (const m of this.needle.materials) m.opacity = opacity;
    this.needle.glow.uniforms.uOpacity.value = 0.55 * opacity;
    this.needle.tipGlow.opacity = 0.8 * opacity;
    this.needle.group.visible = opacity > 0.01;
  }

  /** Keep the shaft about SHAFT_PX thick on screen, whatever the distance or canvas size. */
  private fitThickness(camera: THREE.PerspectiveCamera, height: number) {
    const dist = this.needle.group.getWorldPosition(this.v).distanceTo(camera.position);
    const pxPerUnit = height / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const scale = THREE.MathUtils.clamp(SHAFT_PX / pxPerUnit / (2 * SHAFT_RADIUS), 1, 3);
    this.needle.group.scale.set(scale, 1, scale);
  }

  /** Advance the animation and position labels. Call after the parent's matrixWorld is current. */
  update(dt: number, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    this.elapsed += dt;

    if (this.opts.reducedMotion) {
      this.updateStatic(camera, width, height);
      return;
    }

    if (!this.current) {
      this.wait -= dt;
      if (this.wait <= 0) this.startAttempt(camera);
    }

    let a = this.current;
    // If the entry turns out of view before the needle stops, cancel and re-run this
    // attempt from a visible spot, so the search sequence is never shown half-hidden.
    if (a && a.phase === "advance" && this.visibility(a.skin, a.normal, camera) < 0.15) {
      this.queue.unshift(a.outcome);
      a.label.remove();
      this.disposeTrack(a.track);
      this.setNeedleOpacity(0);
      this.current = a = null;
      this.wait = 0.15;
    }
    if (a) {
      this.step(a, dt);
      const vis = this.visibility(a.skin, a.normal, camera);
      for (const m of this.needle.materials) m.opacity *= vis;
      this.needle.glow.uniforms.uOpacity.value *= vis;
      this.needle.tipGlow.opacity *= vis;
      a.track.mesh.material.opacity *= vis;
      this.fitThickness(camera, height);
      this.placeLabel(a, a.labelAlpha * vis, camera, width, height);
    }

    // Finished attempts: coloured track and label linger, then fade into history.
    for (const f of this.fading) {
      f.t += dt;
      const x = smooth(f.t, LINGER, LINGER + FADE);
      const at = f.attempt;
      const vis = this.visibility(at.skin, at.normal, camera);
      const endOpacity = at.outcome === "safe" ? 0 : HISTORY_OPACITY;
      at.track.mesh.material.opacity = (1 - (1 - endOpacity) * x) * vis;
      this.placeLabel(at, (1 - x) * vis, camera, width, height);
    }
    for (const f of this.fading.filter((x) => x.t >= LINGER + FADE)) {
      f.attempt.label.remove();
      if (f.attempt.outcome === "safe") this.disposeTrack(f.attempt.track);
      else this.retire(f.attempt.track);
    }
    this.fading = this.fading.filter((x) => x.t < LINGER + FADE);

    // History tracks: faint, fading out when dropped.
    for (const h of this.history) {
      const goal = h.dying ? 0 : HISTORY_OPACITY;
      h.opacity += (goal - h.opacity) * (1 - Math.exp(-dt * 6));
      h.mesh.material.opacity = h.opacity * this.visibility(h.skin, h.normal, camera);
    }
    for (const h of this.history.filter((x) => x.dying && x.opacity < 0.01)) this.disposeTrack(h);
    this.history = this.history.filter((x) => !(x.dying && x.opacity < 0.01));

    // Target: gentle pulse, strong pulse after a safe hit.
    const sinceHit = this.elapsed - this.hitTime;
    const hit = sinceHit < 1.4 ? Math.max(0, Math.sin(sinceHit * 11)) * (1 - sinceHit / 1.4) : 0;
    const idle = 0.5 + 0.5 * Math.sin(this.elapsed * 3);
    this.targetDot.scale.setScalar(1 + idle * 0.15 + hit * 0.8);
    this.targetHalo.scale.setScalar(1.6 + idle * 0.8 + hit * 3);
    this.targetHalo.material.opacity = 0.2 + hit * 0.35;
  }

  /** Reduced motion: one static safe track with its label, no needle, no loop. */
  private updateStatic(camera: THREE.PerspectiveCamera, width: number, height: number) {
    if (!this.staticAttempt) {
      const a = this.createAttempt("safe", this.plan("safe", camera));
      a.track.mesh.geometry.setDrawRange(0, Infinity);
      a.track.mesh.material.color.copy(this.risk.safe);
      this.staticAttempt = a;
      this.targetDot.scale.setScalar(1.15);
      this.targetHalo.scale.setScalar(2.2);
    }
    const a = this.staticAttempt;
    const vis = this.visibility(a.skin, a.normal, camera);
    a.track.mesh.material.opacity = vis;
    this.placeLabel(a, vis, camera, width, height);
  }

  private step(a: Attempt, dt: number) {
    a.t += dt;
    let needleOpacity = 1;

    switch (a.phase) {
      case "advance":
        needleOpacity = Math.min(a.t / FADE_IN, 1);
        a.d = Math.min(a.length, a.d + a.speed * speedProfile(a.d, a.length) * dt);
        if (a.d >= a.length - 1e-4) {
          a.d = a.length;
          a.track.mesh.material.color.copy(this.risk[LEVEL[a.outcome]]);
          if (a.outcome === "safe") this.hitTime = this.elapsed;
          this.next(a, "hold");
        }
        break;
      case "hold":
        a.labelAlpha = Math.min(a.t / 0.15, 1);
        if (a.t >= (a.outcome === "safe" ? HOLD_SAFE : HOLD)) this.next(a, "withdraw");
        break;
      case "withdraw": {
        const x = Math.min(a.t / WITHDRAW, 1);
        const eased = x * x * (3 - 2 * x); // smooth start and stop
        a.d = a.length - (a.length + 0.12) * eased;
        needleOpacity = 1 - eased;
        if (x >= 1) this.endAttempt(a);
        break;
      }
    }

    // Needle: tip at distance d along the line.
    this.needle.group.position.copy(a.start).addScaledVector(a.dir, a.d);
    this.setNeedleOpacity(this.current ? needleOpacity : 0);

    // Track: the stretch travelled so far (full once it has stopped).
    const reached = a.phase === "advance" ? a.d / a.length : 1;
    const count = a.track.mesh.geometry.index?.count ?? 0;
    a.track.mesh.geometry.setDrawRange(0, Math.floor((count * reached) / 6) * 6);
    a.track.mesh.material.opacity = 1;
  }

  private next(a: Attempt, phase: Phase) {
    a.phase = phase;
    a.t = 0;
  }

  /** Needle is out: hand the track and label to the fading list and queue the next attempt. */
  private endAttempt(a: Attempt) {
    this.current = null;
    this.fading.push({ attempt: a, t: 0 });
    this.wait = GAP;
    // End of a sequence: clear the search history before the next one starts.
    if (a.outcome === "safe") {
      for (const h of this.history) h.dying = true;
      this.wait = GAP_RESTART;
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
    const attempts = [this.current, this.staticAttempt, ...this.fading.map((f) => f.attempt)];
    for (const a of attempts) {
      if (!a) continue;
      a.label.remove();
      this.disposeTrack(a.track);
    }
    for (const h of this.history) this.disposeTrack(h);
    this.needle.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.needle.materials) m.dispose();
    this.needle.glow.dispose();
    this.needle.tipGlow.map?.dispose();
    this.needle.tipGlow.dispose();
    this.targetDot.geometry.dispose();
    this.targetDot.material.dispose();
    this.targetHalo.geometry.dispose();
    this.targetHalo.material.dispose();
  }
}
