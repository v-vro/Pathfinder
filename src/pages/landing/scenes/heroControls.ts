/**
 * Input for the landing hero skeleton.
 *
 * - Mouse position anywhere on the window tilts the model (±60° yaw, ±25° pitch), damped.
 * - Click/touch-drag on the canvas spins it freely (full 360° yaw).
 * - Wheel / trackpad pinch / two-finger pinch zooms in a little, within limits.
 *   Plain wheel only zooms while the page is at the top, and lets the page scroll once
 *   zoom is back at its minimum, so it never traps scrolling.
 * - After release, the spin drifts back toward the mouse-follow view.
 * - After a few idle seconds, it slowly auto-rotates.
 * - Reduced motion: smaller follow range, no auto-rotate, no easing (snaps to input).
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const FOLLOW_YAW = 60 * DEG;
const FOLLOW_PITCH = 25 * DEG;
const FOLLOW_YAW_REDUCED = 15 * DEG;
const FOLLOW_PITCH_REDUCED = 6 * DEG;
/** Mouse sensitivity: full range is reached this far before the window edge. */
const SENSITIVITY = 1.8;
const DRAG_YAW_PER_PX = 0.01; // ~630px drag = one full turn
const DRAG_PITCH_PER_PX = 0.006;
const MAX_PITCH = 70 * DEG;
const ZOOM_MIN = 1;
const ZOOM_MAX = 1.35;
const IDLE_MS = 4000;
const AUTO_ROTATE_SPEED = 0.28; // rad/s
const BASE_YAW = 0.35;
const BASE_PITCH = 0.06;

function damp(a: number, b: number, lambda: number, dt: number) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fired (bubbling) on the canvas once, on the first deliberate mouse move, drag or zoom. */
export const FIRST_INTERACTION_EVENT = "pf:first-interaction";

export interface HeroControlsOptions {
  reducedMotion: boolean;
  /** Request a redraw (needed in reduced-motion mode, where there is no render loop). */
  invalidate: () => void;
}

export class HeroControls {
  /** Current, damped values. Read these every frame. */
  yaw = BASE_YAW;
  pitch = BASE_PITCH;
  zoom = ZOOM_MIN;

  private followX = 0;
  private followY = 0;
  private offsetYaw = 0;
  private offsetPitch = 0;
  private targetZoom = ZOOM_MIN;
  private dragging = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private lastActivity: number;
  private idleSince = 0;
  private moved = 0;
  private interacted = false;
  private readonly el: HTMLElement;
  private readonly opts: HeroControlsOptions;

  constructor(el: HTMLElement, opts: HeroControlsOptions) {
    this.el = el;
    this.opts = opts;
    // Start auto-rotating a couple of seconds after load if nothing happens.
    this.lastActivity = performance.now() - IDLE_MS + 2500;

    el.style.touchAction = "pan-y"; // vertical swipes still scroll the page on phones
    el.style.cursor = "grab";

    window.addEventListener("pointermove", this.onWindowMove, { passive: true });
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onDragMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
  }

  dispose() {
    window.removeEventListener("pointermove", this.onWindowMove);
    this.el.removeEventListener("pointerdown", this.onDown);
    this.el.removeEventListener("pointermove", this.onDragMove);
    this.el.removeEventListener("pointerup", this.onUp);
    this.el.removeEventListener("pointercancel", this.onUp);
    this.el.removeEventListener("wheel", this.onWheel);
  }

  private active() {
    this.lastActivity = performance.now();
    this.opts.invalidate();
  }

  private firstInteraction() {
    if (this.interacted) return;
    this.interacted = true;
    this.el.dispatchEvent(new Event(FIRST_INTERACTION_EVENT, { bubbles: true }));
  }

  private onWindowMove = (e: PointerEvent) => {
    if (e.pointerType === "touch" || this.dragging) return;
    this.followX = clamp(((e.clientX / window.innerWidth) * 2 - 1) * SENSITIVITY, -1, 1);
    this.followY = clamp(-((e.clientY / window.innerHeight) * 2 - 1) * SENSITIVITY, -1, 1);
    this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (this.moved > 40) this.firstInteraction();
    this.active();
  };

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.el.style.cursor = "grabbing";
    } else if (this.pointers.size === 2) {
      this.pinchDistance = this.currentPinchDistance();
    }
    this.firstInteraction();
    this.active();
  };

  private onDragMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (this.pointers.size >= 2) {
      const d = this.currentPinchDistance();
      if (this.pinchDistance > 0 && d > 0) {
        this.targetZoom = clamp(this.targetZoom * (d / this.pinchDistance), ZOOM_MIN, ZOOM_MAX);
      }
      this.pinchDistance = d;
    } else if (this.dragging) {
      this.offsetYaw += dx * DRAG_YAW_PER_PX;
      const pitchNow = BASE_PITCH + this.followPitch() + this.offsetPitch;
      const next = clamp(pitchNow + dy * DRAG_PITCH_PER_PX, -MAX_PITCH, MAX_PITCH);
      this.offsetPitch += next - pitchNow;
    }
    this.active();
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.el.style.cursor = "grab";
    }
    this.active();
  };

  private onWheel = (e: WheelEvent) => {
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const atTop = window.scrollY <= 2;
    // Trackpad pinch arrives as ctrl+wheel: always ours. Plain wheel: only zoom in at the
    // top of the page, and only zoom out while zoomed, so page scrolling is never trapped.
    const zoomIn = e.deltaY < 0 && atTop && this.targetZoom < ZOOM_MAX - 1e-3;
    const zoomOut = e.deltaY > 0 && this.targetZoom > ZOOM_MIN + 1e-3;
    if (!e.ctrlKey && !zoomIn && !zoomOut) return;
    e.preventDefault();
    this.targetZoom = clamp(this.targetZoom * factor, ZOOM_MIN, ZOOM_MAX);
    this.firstInteraction();
    this.active();
  };

  private currentPinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private followYaw() {
    return this.followX * (this.opts.reducedMotion ? FOLLOW_YAW_REDUCED : FOLLOW_YAW);
  }

  private followPitch() {
    return this.followY * (this.opts.reducedMotion ? FOLLOW_PITCH_REDUCED : FOLLOW_PITCH);
  }

  /** Advance the damping. Call once per frame. */
  update(dt: number) {
    const now = performance.now();
    const idle = !this.dragging && now - this.lastActivity > IDLE_MS;

    if (this.opts.reducedMotion) {
      this.yaw = BASE_YAW + this.followYaw() + this.offsetYaw;
      this.pitch = clamp(BASE_PITCH + this.followPitch() + this.offsetPitch, -MAX_PITCH, MAX_PITCH);
      this.zoom = this.targetZoom;
      return;
    }

    if (idle) {
      if (!this.idleSince) this.idleSince = now;
      const ramp = Math.min(1, (now - this.idleSince) / 1500);
      this.offsetYaw += AUTO_ROTATE_SPEED * ramp * dt;
    } else {
      this.idleSince = 0;
      if (!this.dragging) {
        // Drift back to the follow view (to the nearest full turn, so it never unwinds).
        const home = Math.round(this.offsetYaw / TAU) * TAU;
        this.offsetYaw = damp(this.offsetYaw, home, 0.9, dt);
        this.offsetPitch = damp(this.offsetPitch, 0, 0.9, dt);
      }
    }

    const targetYaw = BASE_YAW + this.followYaw() + this.offsetYaw;
    const targetPitch = clamp(
      BASE_PITCH + this.followPitch() + this.offsetPitch,
      -MAX_PITCH,
      MAX_PITCH,
    );
    const rate = this.dragging ? 14 : 4.5;
    this.yaw = damp(this.yaw, targetYaw, rate, dt);
    this.pitch = damp(this.pitch, targetPitch, rate, dt);
    this.zoom = damp(this.zoom, this.targetZoom, 6, dt);
  }
}
