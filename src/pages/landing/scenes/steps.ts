import * as THREE from "three";
import type { DitherSceneSetup } from "../../../components/DitherCanvas";
import {
  createGlowSprite,
  createMarkerMaterial,
  ditherMarkerColor,
  disposeObject,
} from "../../../components/dither/markers";

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-2, 3, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(2, 1, -3);
  scene.add(rim);
}

function lungWidth(u: number) {
  // 0 = base, 1 = apex
  return (
    Math.pow(Math.max(0, Math.sin(Math.PI * (0.18 + 0.82 * u))), 0.6) *
    THREE.MathUtils.lerp(1, 0.55, u)
  );
}

/** 1. Scan to 3D body: CT slices stack up into two lungs as a scan plane sweeps. */
export const scanScene: DitherSceneSetup = ({ scene, camera, reducedMotion }) => {
  camera.position.set(0, 1.7, 4.3);
  camera.lookAt(0, -0.05, 0);
  addLights(scene);

  const group = new THREE.Group();
  scene.add(group);

  // Each CT slice is drawn as a pair of lung contours.
  const SLICES = 14;
  const slices: { y: number; mat: THREE.MeshBasicMaterial }[] = [];
  const ring = new THREE.RingGeometry(0.8, 1, 48);
  for (let i = 0; i < SLICES; i++) {
    const u = i / (SLICES - 1);
    const y = -1 + u * 2;
    const w = Math.max(lungWidth(u), 0.12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(ring, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(side * 0.5, y, 0);
      m.scale.set(0.42 * w, 0.55 * w, 1);
      group.add(m);
    }
    slices.push({ y, mat });
  }

  // Scan plane: outline plus a faint fill.
  const planeGeo = new THREE.PlaneGeometry(2.1, 1.4);
  const plane = new THREE.Mesh(
    planeGeo,
    new THREE.MeshBasicMaterial({
      color: ditherMarkerColor("fg", 0.14),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 2;
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(planeGeo),
    new THREE.LineBasicMaterial({ color: ditherMarkerColor("fg"), fog: false }),
  );
  edge.rotation.x = -Math.PI / 2;
  group.add(plane, edge);

  const primary = ditherMarkerColor("fg");

  return {
    update({ time }) {
      const cycle = reducedMotion ? 0.999 : (time % 6) / 6;
      const scanY = -1.12 + Math.min(cycle / 0.8, 1) * 2.24;
      plane.position.y = edge.position.y = scanY;
      const hidden = reducedMotion || cycle > 0.85;
      plane.visible = edge.visible = !hidden;
      for (const s of slices) {
        const d = scanY - s.y;
        if (!hidden && d >= 0 && d < 0.16)
          s.mat.color.copy(primary); // just scanned
        else s.mat.color.setScalar(d >= 0 ? 0.8 : 0.06);
      }
      group.rotation.y = reducedMotion ? 0.4 : time * 0.25;
    },
    dispose: () => disposeObject(scene),
  };
};

function ribArc(y: number, z: number, width: number): THREE.TubeGeometry {
  const pts = [];
  for (let k = 0; k <= 10; k++) {
    const f = k / 10;
    const a = -0.9 + f * 1.8;
    pts.push(
      new THREE.Vector3(Math.sin(a) * width, y - Math.abs(f - 0.5) * 0.15, z + Math.cos(a) * 0.35),
    );
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.07, 8, false);
}

/** 2. Aim and see the risk: a needle sweeps toward a target; rib crossings dim it. */
export const aimScene: DitherSceneSetup = ({ scene, camera, reducedMotion }) => {
  camera.position.set(1.2, 0.6, 4.4);
  camera.lookAt(0, 0, 0);
  addLights(scene);

  const group = new THREE.Group();
  scene.add(group);

  const lung = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 28),
    new THREE.MeshStandardMaterial({
      color: 0x5a5a5a,
      roughness: 0.7,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  lung.scale.set(0.85, 1.25, 0.8);
  lung.position.z = -0.4;
  lung.renderOrder = 1;
  group.add(lung);

  const bone = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const ribYs = [0.75, 0.2, -0.35, -0.9];
  for (const y of ribYs) group.add(new THREE.Mesh(ribArc(y, 0.25, 1.2), bone));

  const target = new THREE.Vector3(0.05, -0.05, -0.35);
  const lesion = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 20, 14),
    createMarkerMaterial("fg", { transparent: true }),
  );
  lesion.position.copy(target);
  lesion.renderOrder = 2;
  const glow = createGlowSprite("fg", 0.8);
  glow.position.copy(target);
  glow.renderOrder = 2;
  group.add(lesion, glow);

  const needleLen = 1.9;
  const needleMat = createMarkerMaterial("fg", { transparent: true });
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, needleLen, 8), needleMat);
  needle.geometry.translate(0, needleLen / 2 + 0.1, 0);
  needle.renderOrder = 2;
  group.add(needle);

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  return {
    update({ time }) {
      const a = reducedMotion ? 0.05 : Math.sin(time * 0.7) * 0.75;
      dir.set(Math.sin(a) * 0.35, Math.sin(a), 1).normalize();
      needle.position.copy(target);
      needle.quaternion.setFromUnitVectors(up, dir);

      // Where the needle crosses the rib plane; dim it if it hits a rib.
      const t = (0.55 - target.z) / dir.z;
      tmp.copy(target).addScaledVector(dir, t);
      const nearest = Math.min(...ribYs.map((y) => Math.abs(tmp.y - y)));
      const blocked = THREE.MathUtils.smoothstep(0.22 - nearest, 0, 0.1);
      needleMat.color.copy(ditherMarkerColor("fg", 1 - blocked * 0.75));

      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      (glow.material as THREE.SpriteMaterial).opacity = reducedMotion ? 0.8 : 0.4 + pulse * 0.6;
      group.rotation.y = reducedMotion ? -0.2 : -0.2 + Math.sin(time * 0.3) * 0.25;
    },
    dispose: () => disposeObject(scene),
  };
};

/** 3. Safest path, explained: candidate routes are tried, the safest one lights up. */
export const pathScene: DitherSceneSetup = ({ scene, camera, reducedMotion }) => {
  camera.position.set(0, 0.8, 4.6);
  camera.lookAt(0, 0, 0);
  addLights(scene);

  const group = new THREE.Group();
  scene.add(group);

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x161616, wireframe: true }),
  );
  group.add(shell);

  const lesion = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 20, 14),
    createMarkerMaterial("fg", { transparent: true }),
  );
  lesion.renderOrder = 2;
  const glow = createGlowSprite("fg", 0.9);
  glow.renderOrder = 2;
  group.add(lesion, glow);

  const N = 9;
  const best = 6;
  const paths: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; dot: THREE.Mesh }[] = [];
  for (let i = 0; i < N; i++) {
    const phi = (i / N) * Math.PI * 2 + 0.3;
    const lat = Math.sin(i * 2.1) * 0.6;
    const start = new THREE.Vector3(
      Math.cos(phi) * Math.cos(lat),
      Math.sin(lat),
      Math.sin(phi) * Math.cos(lat),
    ).multiplyScalar(1.35);
    const end = start.clone().normalize().multiplyScalar(0.14);
    const mat = new THREE.MeshBasicMaterial({ color: 0x404040, transparent: true });
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.LineCurve3(start, end), 8, 0.02, 6, false),
      mat,
    );
    mesh.renderOrder = 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat);
    dot.position.copy(start);
    dot.renderOrder = 2;
    group.add(mesh, dot);
    paths.push({ mesh, mat, dot });
  }

  const grey = new THREE.Color(0x6a6a6a);
  const dim = new THREE.Color(0x303030);
  const on = ditherMarkerColor("fg");

  return {
    update({ time }) {
      // 0-3.6s: scan candidates one by one. 3.6-7s: settle on the best.
      const cycle = reducedMotion ? 6 : time % 7;
      const scanning = cycle < 3.6;
      const active = scanning ? Math.floor((cycle / 3.6) * N) : best;
      paths.forEach((p, i) => {
        if (i === active) p.mat.color.copy(on);
        else p.mat.color.copy(scanning ? grey : dim);
      });
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      (glow.material as THREE.SpriteMaterial).opacity = reducedMotion ? 0.8 : 0.4 + pulse * 0.6;
      group.rotation.y = reducedMotion ? 0.3 : time * 0.18;
    },
    dispose: () => disposeObject(scene),
  };
};
