import * as THREE from "three";

/**
 * Marker kinds for <DitherCanvas> scenes.
 *
 * - "fg":      solid foreground (white). Needles, targets, scan planes, highlights.
 *              Plain luminance, so it fades through the 1-bit dither like everything else.
 * - "safe" | "caution" | "danger": drawn in the matching --risk-* colour instead of being
 *              dithered to black/white. Risk colours are reserved for risk meaning only
 *              (see THEME.md); always pair them with a text or icon label (<RiskLabel>).
 */
export type DitherMarker = "fg" | "safe" | "caution" | "danger";

/**
 * Colour to put on an unlit material so the dither pass draws it as `kind`.
 * `intensity` (0..1) is roughly the share of the dither cells that light up.
 */
export function ditherMarkerColor(kind: DitherMarker, intensity = 1): THREE.Color {
  switch (kind) {
    case "safe":
      return new THREE.Color(0, 1, 0).multiplyScalar(intensity);
    case "caution":
      return new THREE.Color(1, 1, 0).multiplyScalar(intensity);
    case "danger":
      return new THREE.Color(1, 0, 0).multiplyScalar(intensity);
    default:
      // The shader works in perceptual space, so undo the gamma to keep `intensity` linear-ish.
      return new THREE.Color(1, 1, 1).multiplyScalar(Math.pow(intensity, 2.2));
  }
}

export function createMarkerMaterial(
  kind: DitherMarker,
  opts: { intensity?: number; transparent?: boolean } = {},
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: ditherMarkerColor(kind, opts.intensity ?? 1),
    fog: false,
    transparent: opts.transparent ?? false,
  });
}

/** Soft radial glow sprite in a marker colour (additive). */
export function createGlowSprite(kind: DitherMarker, size = 1): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  const rgb =
    kind === "safe"
      ? "0,255,0"
      : kind === "caution"
        ? "255,255,0"
        : kind === "danger"
          ? "255,0,0"
          : "255,255,255";
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.35, `rgba(${rgb},0.45)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(size);
  return sprite;
}

/** Dispose every geometry, material and texture under an object. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const m of mats) {
      for (const v of Object.values(m)) {
        if (v instanceof THREE.Texture) v.dispose();
      }
      m.dispose();
    }
  });
}
