import * as THREE from "three";

/**
 * Colours that <DitherCanvas> treats as "draw me in a palette colour" instead of
 * dithering by brightness. Use them on unlit (MeshBasic / LineBasic) materials.
 *
 * - "primary": drawn in the dither fg colour (teal). Needles, paths, scan planes.
 * - "accent":  drawn in the dither accent colour (amber). Targets and lesions only.
 *
 * Scale the colour (e.g. `.multiplyScalar(0.5)`) to fade a marker; the shader dithers
 * the fade.
 */
export function ditherMarkerColor(kind: "primary" | "accent", intensity = 1): THREE.Color {
  const c = kind === "primary" ? new THREE.Color(0, 1, 0) : new THREE.Color(1, 0, 0);
  return c.multiplyScalar(intensity);
}

export function createMarkerMaterial(
  kind: "primary" | "accent",
  opts: { intensity?: number; transparent?: boolean } = {},
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: ditherMarkerColor(kind, opts.intensity ?? 1),
    fog: false,
    transparent: opts.transparent ?? false,
  });
}

/** Soft radial glow sprite in a marker colour (additive). */
export function createGlowSprite(kind: "primary" | "accent", size = 1): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  const rgb = kind === "primary" ? "0,255,0" : "255,0,0";
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
