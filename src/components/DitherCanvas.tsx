import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { ditherFragmentShader, ditherVertexShader } from "./dither/ditherShader";
import "./components.css";

export interface DitherFrame {
  /** Seconds since the scene started. Frozen at 0 when reduced motion is on. */
  time: number;
  /** Seconds since the last frame (clamped). */
  delta: number;
  /** Smoothed pointer position over the window, -1..1 on each axis. Zero with reduced motion. */
  pointer: THREE.Vector2;
}

export interface DitherSceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  reducedMotion: boolean;
  /** Ask for a redraw (needed when reduced motion is on and something loads async). */
  invalidate: () => void;
}

export interface DitherSceneHandle {
  update?: (frame: DitherFrame) => void;
  dispose?: () => void;
}

/**
 * Builds a three.js scene. Called once per mount. Keep the function identity stable
 * (define it at module level or wrap it in useMemo/useCallback) or the scene rebuilds.
 */
export type DitherSceneSetup = (ctx: DitherSceneContext) => DitherSceneHandle | void;

export interface DitherPalette {
  /** Any CSS colour, a custom property name ("--dither-bg") or "var(--dither-bg)". */
  bg?: string;
  mid?: string;
  fg?: string;
  accent?: string;
}

export interface DitherCanvasProps {
  setup: DitherSceneSetup;
  /** Dither cell size in CSS pixels. Multiplied by devicePixelRatio and rounded. */
  pixelSize?: number;
  /** 2 = bg/fg only, 3 = bg/mid/fg. */
  levels?: 2 | 3;
  /** Bayer matrix size. */
  matrix?: 4 | 8;
  palette?: DitherPalette;
  contrast?: number;
  brightness?: number;
  /** Stop the render loop (e.g. while a modal is open). */
  paused?: boolean;
  /** Accessible description. If omitted the canvas is treated as decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_PALETTE: Required<DitherPalette> = {
  bg: "--dither-bg",
  mid: "--dither-mid",
  fg: "--dither-fg",
  accent: "--dither-accent",
};

let probe: CanvasRenderingContext2D | null = null;

/** Resolve a CSS colour / custom property to sRGB 0..1 components. */
function resolveColor(el: Element, value: string): THREE.Vector3 {
  let v = value.trim();
  const varMatch = v.match(/^var\(\s*(--[^,)\s]+)/);
  if (varMatch) v = varMatch[1];
  if (v.startsWith("--")) v = getComputedStyle(el).getPropertyValue(v).trim();

  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe || !v) return new THREE.Vector3(0, 0, 0);
  probe.fillStyle = "#000";
  probe.fillStyle = v;
  const out = String(probe.fillStyle);
  if (out.startsWith("#")) {
    const n = parseInt(out.slice(1), 16);
    return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  const nums = out.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return new THREE.Vector3(nums[0] / 255, nums[1] / 255, nums[2] / 255);
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

interface Internals {
  material: THREE.ShaderMaterial;
  resize: () => void;
  requestFrame: () => void;
}

/**
 * A three.js scene drawn through an ordered-dither post-process in the theme palette.
 * See THEME.md for usage.
 */
export function DitherCanvas({
  setup,
  pixelSize = 3,
  levels = 3,
  matrix = 8,
  palette,
  contrast = 1,
  brightness = 0,
  paused = false,
  label,
  className,
  style,
}: DitherCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const internals = useRef<Internals | null>(null);
  const pixelSizeRef = useRef(pixelSize);
  const pausedRef = useRef(paused);
  const reducedMotion = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);

  // Scene + renderer lifecycle.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.className = "pf-dither__canvas";
    canvas.setAttribute("aria-hidden", "true");

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      // Fallback styling is applied via the `failed` state; no WebGL available.
      queueMicrotask(() => setFailed(true));
      return;
    }
    host.appendChild(canvas);
    renderer.setClearColor(0x000000, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    camera.position.set(0, 0, 6);

    const target = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });

    const material = new THREE.ShaderMaterial({
      vertexShader: ditherVertexShader,
      fragmentShader: ditherFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: target.texture },
        uCells: { value: new THREE.Vector2(1, 1) },
        uCellSize: { value: 1 },
        uLevels: { value: 3 },
        uMatrix: { value: 8 },
        uContrast: { value: 1 },
        uBrightness: { value: 0 },
        uBg: { value: new THREE.Vector3() },
        uMid: { value: new THREE.Vector3() },
        uFg: { value: new THREE.Vector3() },
        uAccent: { value: new THREE.Vector3() },
      },
    });
    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    postScene.add(quad);

    let raf = 0;
    let visible = true;
    let needsFrame = true;
    let start = performance.now();
    let last = start;
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const frame: DitherFrame = { time: 0, delta: 0, pointer };

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      const deviceW = Math.floor(w * dpr);
      const deviceH = Math.floor(h * dpr);
      const cell = Math.max(1, Math.round(pixelSizeRef.current * dpr));
      const cellsX = Math.ceil(deviceW / cell);
      const cellsY = Math.ceil(deviceH / cell);
      target.setSize(cellsX * 2, cellsY * 2);
      material.uniforms.uCells.value.set(cellsX, cellsY);
      material.uniforms.uCellSize.value = cell;
      // Match the aspect of the cell grid (which can be a fraction of a cell larger).
      camera.aspect = (cellsX * cell) / (cellsY * cell);
      camera.updateProjectionMatrix();
      needsFrame = true;
      requestFrame();
    };

    const ctx: DitherSceneContext = {
      scene,
      camera,
      renderer,
      reducedMotion,
      invalidate: () => {
        needsFrame = true;
        requestFrame();
      },
    };
    const handle = setup(ctx) || {};

    const renderOnce = () => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    };

    const tick = (now: number) => {
      raf = 0;
      const animate = !reducedMotion && !pausedRef.current && visible;
      if (!animate && !needsFrame) return;

      frame.delta = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (animate) {
        frame.time = (now - start) / 1000;
        pointer.lerp(pointerTarget, 1 - Math.exp(-frame.delta * 4));
      }
      handle.update?.(frame);
      renderOnce();
      needsFrame = false;
      if (animate) raf = requestAnimationFrame(tick);
    };

    function requestFrame() {
      if (!raf && visible) raf = requestAnimationFrame(tick);
    }

    const onPointer = (e: PointerEvent) => {
      if (reducedMotion) return;
      pointerTarget.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -((e.clientY / window.innerHeight) * 2 - 1),
      );
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) {
          // Avoid a time jump after being off-screen.
          const now = performance.now();
          start += now - last;
          last = now;
          requestFrame();
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(host);

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    window.addEventListener("resize", resize);

    const onVisibility = () => {
      if (document.hidden) return;
      const now = performance.now();
      start += now - last;
      last = now;
      requestFrame();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    internals.current = { material, resize, requestFrame };
    resize();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      handle.dispose?.();
      quad.geometry.dispose();
      material.dispose();
      target.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      internals.current = null;
    };
  }, [setup, reducedMotion]);

  // Cheap prop updates: no scene rebuild.
  const paletteKey = JSON.stringify(palette ?? {});
  useEffect(() => {
    const it = internals.current;
    const host = hostRef.current;
    if (!it || !host) return;
    const p = { ...DEFAULT_PALETTE, ...(JSON.parse(paletteKey) as DitherPalette) };
    const u = it.material.uniforms;
    u.uBg.value.copy(resolveColor(host, p.bg));
    u.uMid.value.copy(resolveColor(host, p.mid));
    u.uFg.value.copy(resolveColor(host, p.fg));
    u.uAccent.value.copy(resolveColor(host, p.accent));
    u.uLevels.value = levels;
    u.uMatrix.value = matrix;
    u.uContrast.value = contrast;
    u.uBrightness.value = brightness;
    pixelSizeRef.current = pixelSize;
    it.resize();
  }, [paletteKey, levels, matrix, contrast, brightness, pixelSize, setup, reducedMotion]);

  useEffect(() => {
    pausedRef.current = paused;
    internals.current?.requestFrame();
  }, [paused]);

  const classes = ["pf-dither", failed && "pf-dither--fallback", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      ref={hostRef}
      className={classes}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
