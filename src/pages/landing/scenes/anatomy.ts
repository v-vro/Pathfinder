import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { DitherSceneSetup } from "../../../components/DitherCanvas";
import {
  createGlowSprite,
  createMarkerMaterial,
  ditherMarkerColor,
  disposeObject,
  type DitherMarker,
} from "../../../components/dither/markers";

/**
 * Real meshes to use instead of the procedural ones. Keys are structure names from the
 * pipeline contract (skin, ribs, lungs, lobes, vessels, heart, lesion, emphysema);
 * values are .glb URLs, e.g. "/cases/case01/ribs.glb".
 */
export type AnatomyModels = Partial<
  Record<"skin" | "ribs" | "lungs" | "lobes" | "vessels" | "heart" | "lesion" | "emphysema", string>
>;

export type Vec3 = [number, number, number];

export interface AnatomySceneOptions {
  models?: AnatomyModels;
  /** Needle entry (on/outside skin) and target, in the same coordinate space as the models (mm). */
  needle?: { entry: Vec3; target: Vec3; segments?: RiskSegment[] };
  /**
   * Rotation applied to loaded models before framing. Default turns CT patient space
   * (LPS: x left, y posterior, z superior) into three.js (y up, patient facing +z).
   */
  modelRotation?: Vec3;
  /** Framing preset. */
  view?: "hero" | "poster";
  /** Colour the needle path with risk markers (hero only). Off = plain white path. */
  riskPreview?: boolean;
}

const BODY_HEIGHT = 2.5;

// ---------- Materials ----------

function boneMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0 });
}

function lungMaterial(opacity = 0.72) {
  return new THREE.MeshStandardMaterial({
    color: 0x6e6e6e,
    roughness: 0.7,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

function softMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.8 });
}

/** Marker objects draw after the translucent lungs so they never get tinted. */
function onTop<T extends THREE.Object3D>(obj: T): T {
  obj.renderOrder = 2;
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) m.transparent = true;
  });
  return obj;
}

// ---------- Procedural anatomy ----------

interface Rib {
  curve: THREE.CatmullRomCurve3;
  side: number;
}

function buildRibs(): { group: THREE.Group; ribs: Rib[] } {
  const group = new THREE.Group();
  const mat = boneMaterial();
  const ribs: Rib[] = [];
  const count = 10;
  const spineZ = -0.72;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const yBack = 1.02 - i * 0.205;
    const a = 0.55 + 0.56 * Math.sin(Math.min(t * 1.5 + 0.15, 1) * (Math.PI / 2)); // half-width
    const b = 0.5 + 0.22 * Math.sin(Math.min(t * 1.4 + 0.2, 1) * (Math.PI / 2)); // half-depth
    const zc = spineZ + b;
    const theta0 = -Math.PI / 2 + 0.16;
    const theta1 = Math.PI / 2 - (0.22 + t * 0.75);
    const drop = 0.32 + t * 0.12;

    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const n = 14;
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const th = theta0 + (theta1 - theta0) * f;
        const bow = Math.sin(f * Math.PI) * 0.05;
        pts.push(
          new THREE.Vector3(
            side * a * Math.cos(th),
            yBack - drop * f * f + bow,
            zc + b * Math.sin(th),
          ),
        );
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const radius = 0.04 + t * 0.008;
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, radius, 6, false), mat);
      group.add(mesh);
      ribs.push({ curve, side });
    }
  }

  // Spine: stacked vertebrae
  const vert = new THREE.CylinderGeometry(0.075, 0.08, 0.13, 10);
  for (let i = 0; i < 17; i++) {
    const m = new THREE.Mesh(vert, mat);
    m.position.set(0, 1.18 - i * 0.15, spineZ - 0.06);
    group.add(m);
  }

  // Sternum
  const sternum = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.85, 4, 10), mat);
  const front = ribs[2].curve.getPoint(1);
  sternum.position.set(0, 0.55, front.z + 0.02);
  sternum.scale.set(1.3, 1, 0.6);
  group.add(sternum);

  // Clavicles
  for (const side of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.07, 1.02, front.z + 0.02),
      new THREE.Vector3(side * 0.45, 1.12, front.z - 0.02),
      new THREE.Vector3(side * 0.85, 1.16, front.z - 0.25),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(c, 20, 0.035, 6, false), mat));
  }

  return { group, ribs };
}

function buildLung(side: number): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(0.42, 1.0, 10, 28);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = THREE.MathUtils.clamp((v.y + 0.92) / 1.84, 0, 1); // 0 bottom .. 1 apex
    const w = THREE.MathUtils.lerp(1.18, 0.5, Math.pow(u, 1.6));
    let x = v.x * w;
    // Flatten the medial side (towards the heart).
    if (x * side < 0) x *= side > 0 ? 0.45 : 0.6;
    // Concave base sitting on the diaphragm dome.
    const y = u < 0.12 ? v.y + (0.12 - u) * 0.9 * (1 - Math.min(1, Math.abs(v.x) / 0.5)) : v.y;
    pos.setXYZ(i, x, y, v.z * w * 1.12);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, lungMaterial());
  mesh.position.set(side * 0.47, 0.05, -0.12);
  if (side > 0) mesh.scale.setScalar(0.93); // patient-left lung is a little smaller
  mesh.renderOrder = 1;
  return mesh;
}

// ---------- Needle + target ----------

/** A stretch of the needle path coloured by risk: from the previous segment's `to` up to this `to` (0..1). */
export interface RiskSegment {
  to: number;
  risk: "safe" | "caution" | "danger";
}

/** Preview colouring: chest wall safe, pleural crossing caution, lung to target safe. */
function defaultSegments(entryFrac: number): RiskSegment[] {
  return [
    { to: entryFrac, risk: "safe" },
    { to: Math.min(entryFrac + 0.12, 0.95), risk: "caution" },
    { to: 1, risk: "safe" },
  ];
}

interface Needle {
  group: THREE.Group;
  segments: { mesh: THREE.Mesh<THREE.TubeGeometry>; from: number; to: number }[];
  lesion: THREE.Mesh;
  glow: THREE.Sprite;
  ring: THREE.Mesh;
}

function buildNeedle(
  start: THREE.Vector3,
  target: THREE.Vector3,
  risk: { to: number; risk: DitherMarker }[],
  lesionRadius = 0.065,
): Needle {
  const group = new THREE.Group();
  const dir = target.clone().sub(start).normalize();
  const tip = target.clone().addScaledVector(dir, -lesionRadius * 0.9);

  // Needle path, one tube per risk segment.
  const segments: Needle["segments"] = [];
  let from = 0;
  for (const seg of risk) {
    const to = THREE.MathUtils.clamp(seg.to, from, 1);
    if (to - from < 1e-3) continue;
    const a = start.clone().lerp(tip, from);
    const b = start.clone().lerp(tip, to);
    const tubular = Math.max(4, Math.round(64 * (to - from)));
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.LineCurve3(a, b), tubular, 0.014, 6, false),
      createMarkerMaterial(seg.risk),
    );
    group.add(onTop(mesh));
    segments.push({ mesh, from, to });
    from = to;
  }

  // Hub at the needle's outer end.
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.034, 0.034, 0.04, 16),
    createMarkerMaterial("fg"),
  );
  hub.position.copy(start);
  hub.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  group.add(onTop(hub));

  // Entry ring where the path meets the chest wall.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.008, 6, 32),
    createMarkerMaterial("fg", { intensity: 0.7 }),
  );
  ring.position.copy(start.clone().lerp(tip, Math.max(0, (risk[0]?.to ?? 0.6) - 0.06)));
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  group.add(onTop(ring));

  const lesion = new THREE.Mesh(
    new THREE.SphereGeometry(lesionRadius, 20, 14),
    createMarkerMaterial("fg"),
  );
  lesion.position.copy(target);
  group.add(onTop(lesion));

  const glow = createGlowSprite("fg", lesionRadius * 9);
  glow.position.copy(target);
  group.add(onTop(glow));

  return { group, segments, lesion, glow, ring };
}

function proceduralNeedle(ribs: Rib[]): {
  start: THREE.Vector3;
  entry: THREE.Vector3;
  target: THREE.Vector3;
} {
  // Patient's right side (three.js -x): enter between ribs 4 and 5, slightly anterior.
  const right = ribs.filter((r) => r.side < 0);
  const f = 0.62;
  const p1 = right[4].curve.getPoint(f);
  const p2 = right[5].curve.getPoint(f);
  const entry = p1.add(p2).multiplyScalar(0.5);
  const centre = new THREE.Vector3(0, entry.y + 0.08, -0.15);
  const inward = centre.clone().sub(entry).normalize();
  const target = entry.clone().addScaledVector(inward, 0.36);
  const start = entry.clone().addScaledVector(inward, -0.62);
  return { start, entry, target };
}

// ---------- GLB loading ----------

function materialFor(role: string): THREE.Material {
  switch (role) {
    case "ribs":
      return boneMaterial();
    case "lungs":
    case "lobes":
      return lungMaterial(0.5);
    case "skin":
      return lungMaterial(0.12);
    case "lesion":
      return createMarkerMaterial("fg");
    default:
      return softMaterial();
  }
}

async function loadModels(
  models: AnatomyModels,
  rotation: Vec3,
): Promise<{
  root: THREE.Group;
  toScene: (p: Vec3) => THREE.Vector3;
  lesionCentre?: THREE.Vector3;
}> {
  const loader = new GLTFLoader();
  const container = new THREE.Group();
  container.rotation.set(...rotation);

  const entries = Object.entries(models).filter(([, url]) => !!url) as [string, string][];
  const loaded = await Promise.all(
    entries.map(async ([role, url]) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const old = mesh.material;
        (Array.isArray(old) ? old : [old]).forEach((m) => m.dispose());
        mesh.material = materialFor(role);
        if (role === "lungs" || role === "lobes" || role === "skin") mesh.renderOrder = 1;
        if (role === "lesion") onTop(mesh);
      });
      return [role, gltf.scene] as const;
    }),
  );
  for (const [, obj] of loaded) container.add(obj);
  container.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(container);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const s = BODY_HEIGHT / Math.max(size.y, size.x * 0.9, 1e-6);

  const root = new THREE.Group();
  root.scale.setScalar(s);
  root.position.copy(centre).multiplyScalar(-s);
  root.add(container);
  root.updateMatrixWorld(true);

  const toScene = (p: Vec3) => new THREE.Vector3(...p).applyMatrix4(root.matrixWorld);

  const lesionObj = loaded.find(([role]) => role === "lesion")?.[1];
  const lesionCentre = lesionObj
    ? new THREE.Box3().setFromObject(lesionObj).getCenter(new THREE.Vector3())
    : undefined;

  return { root, toScene, lesionCentre };
}

// ---------- Scene factory ----------

function backdrop(): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgb(12,12,12)");
  g.addColorStop(0.55, "rgb(5,5,5)");
  g.addColorStop(1, "rgb(0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false }),
  );
  mesh.position.z = -3;
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * Builds the stylised ribcage + lungs + needle scene for <DitherCanvas>.
 * Pass `models` to swap in real .glb meshes from the pipeline.
 */
export function createAnatomyScene(options: AnatomySceneOptions = {}): DitherSceneSetup {
  const {
    models,
    needle: needleOpt,
    modelRotation = [-Math.PI / 2, 0, 0],
    view = "hero",
    riskPreview = true,
  } = options;

  return ({ scene, camera, reducedMotion, invalidate }) => {
    scene.fog = new THREE.Fog(0x000000, 5.2, 8.6);
    scene.add(backdrop());

    if (view === "hero") {
      camera.position.set(0, 0.12, 5.25);
      camera.lookAt(0, 0.05, 0);
    } else {
      camera.position.set(0.2, 0.25, 5.4);
      camera.lookAt(-0.1, 0.1, 0);
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-2.5, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(3, 1, -4);
    scene.add(rim);

    const body = new THREE.Group();
    scene.add(body);

    // Procedural anatomy (replaced if real models load).
    const procedural = new THREE.Group();
    const { group: ribGroup, ribs } = buildRibs();
    procedural.add(ribGroup, buildLung(-1), buildLung(1));
    body.add(procedural);

    const pn = proceduralNeedle(ribs);
    const entryFrac = pn.start.distanceTo(pn.entry) / pn.start.distanceTo(pn.target);
    const plain = [{ to: 1, risk: "fg" as const }];
    let needle = buildNeedle(pn.start, pn.target, riskPreview ? defaultSegments(entryFrac) : plain);
    body.add(needle.group);

    // Slow scan ring sweeping along the body.
    const scanRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.006, 4, 96),
      createMarkerMaterial("fg", { intensity: 0.45 }),
    );
    scanRing.rotation.x = Math.PI / 2;
    scanRing.scale.set(1, 0.72, 1);
    body.add(onTop(scanRing));

    let cancelled = false;
    let loadedRoot: THREE.Group | null = null;
    if (models && Object.values(models).some(Boolean)) {
      loadModels(models, modelRotation)
        .then(({ root, toScene, lesionCentre }) => {
          if (cancelled) {
            disposeObject(root);
            return;
          }
          body.remove(procedural);
          disposeObject(procedural);
          loadedRoot = root;
          body.add(root);

          let start: THREE.Vector3 | undefined;
          let target: THREE.Vector3 | undefined;
          if (needleOpt) {
            start = toScene(needleOpt.entry);
            target = toScene(needleOpt.target);
            // Start a little outside the skin so the needle reads clearly.
            start.addScaledVector(start.clone().sub(target).normalize(), 0.25);
          } else if (lesionCentre) {
            target = lesionCentre;
            const out = new THREE.Vector3(target.x, 0, target.z).normalize();
            if (out.lengthSq() < 1e-6) out.set(-1, 0, 0);
            start = target.clone().addScaledVector(out, 1.1);
          }
          body.remove(needle.group);
          disposeObject(needle.group);
          if (start && target) {
            needle = buildNeedle(
              start,
              target,
              riskPreview ? (needleOpt?.segments ?? defaultSegments(0.6)) : plain,
              0.05,
            );
            body.add(needle.group);
          }
          invalidate();
        })
        .catch((err) =>
          console.warn("[AnatomyScene] could not load models, keeping procedural meshes", err),
        );
    }

    const baseYaw = 0.55;

    return {
      update({ time, pointer }) {
        if (reducedMotion) {
          body.rotation.set(0.05, baseYaw, 0);
          needle.lesion.scale.setScalar(1);
          (needle.glow.material as THREE.SpriteMaterial).opacity = 0.8;
          scanRing.position.y = 0.4;
          return;
        }

        body.rotation.y = baseYaw + Math.sin(time * 0.22) * 0.6 + pointer.x * 0.2;
        body.rotation.x = 0.05 - pointer.y * 0.08;
        body.position.y = Math.sin(time * 0.6) * 0.03;

        // Needle draws in over the first seconds, then holds.
        const grow = THREE.MathUtils.smoothstep(time, 0.4, 2.6);
        for (const seg of needle.segments) {
          const local = THREE.MathUtils.clamp((grow - seg.from) / (seg.to - seg.from), 0, 1);
          const count = seg.mesh.geometry.index?.count ?? 0;
          seg.mesh.geometry.setDrawRange(0, Math.floor((count * local) / 6) * 6);
        }

        const pulse = 0.5 + 0.5 * Math.sin(time * 3);
        const arrived = THREE.MathUtils.smoothstep(time, 2.2, 2.8);
        needle.lesion.scale.setScalar(1 + pulse * 0.25 * arrived);
        const glowMat = needle.glow.material as THREE.SpriteMaterial;
        glowMat.opacity = (0.35 + pulse * 0.65) * (0.4 + 0.6 * arrived);
        (needle.ring.material as THREE.MeshBasicMaterial).color.copy(
          ditherMarkerColor("fg", 0.4 + 0.5 * arrived),
        );

        scanRing.position.y = Math.sin(time * 0.35) * 1.1;
      },
      dispose() {
        cancelled = true;
        disposeObject(scene);
        if (loadedRoot) disposeObject(loadedRoot);
      },
    };
  };
}
