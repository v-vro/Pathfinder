// Three.js viewer: the patient stands inside a room behind the laptop screen.
// The screen is treated as a physical window (off-axis / head-coupled perspective, Kooima 2008), amplified so
// small head movements let you look around the body.
//
// Visual language:
//  - the body is a solid figure; a window is cut through the skin on the side facing you (it follows your
//    viewpoint), showing the real CT anatomy inside a dark body cavity
//  - vessels are real, slightly translucent geometry with light travelling along them (arteries away from the
//    hilum, veins toward it); where the needle comes within 5 mm they turn amber, within 2 mm they flash red
//  - fissures and the heart / great vessels are faint until the path crosses them, then they flash
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// BVH-accelerated raycasting: picking the body is a tree lookup, not a test of every triangle
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CenterLines } from '../engine/loadCase';
import type { Vec3 } from '../engine/types';

export interface ScreenConfig {
  widthMm: number;
  cameraOffsetMm: number;
}

export type LayerName = 'bones' | 'lungs' | 'fissures' | 'vessels' | 'airways' | 'heart' | 'safezones';

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export type MarkerKind = 'pleura' | 'blocker';
export interface NeedleSpec {
  entry: Vec3;
  target: Vec3;
  color: string;
  markers: { p: Vec3; kind: MarkerKind }[];
  outer?: Vec3 | null;
}

export interface Alerts {
  fissures: string[];
  organs: string[];
}

export interface ProximityStats {
  danger: number;
}

const LOBES = ['lung_upper_lobe_left', 'lung_lower_lobe_left', 'lung_upper_lobe_right', 'lung_middle_lobe_right', 'lung_lower_lobe_right'];
const FISSURES = ['right_oblique_fissure', 'right_horizontal_fissure', 'left_oblique_fissure'];
const GROUPS: Record<LayerName, string[]> = {
  bones: ['ribs', 'scapulae', 'spine'],
  lungs: LOBES,
  fissures: FISSURES,
  vessels: ['arteries', 'veins'],
  airways: ['airways'],
  heart: ['heart', 'great_vessels'],
  safezones: ['skin'],
};
const BASE_OPACITY: Record<string, number> = {
  lobe: 0.09,
  fissure: 0.12,
  heart: 0.9,
  great_vessels: 0.92,
  arteries: 0.88,
  veins: 0.88,
  airways: 0.4,
};

// ---------------------------------------------------------------- shader snippets
const WINDOW_GLSL = /* glsl */ `
uniform vec3 uWinC;
uniform vec3 uWinD;
uniform vec3 uWinR;
uniform vec3 uWinU;
uniform vec2 uWinRad;
// Organic opening: a soft superellipse, wider over the upper chest, with an irregular dissected edge.
float winShape(vec3 p) {
  vec3 q = p - uWinC;
  float b = dot(q, uWinU) / uWinRad.y;
  float a = dot(q, uWinR) / (uWinRad.x * (1.0 + 0.14 * clamp(b, -1.0, 1.0)));
  float th = atan(b, a);
  float wob = 1.0 + 0.055 * sin(3.0 * th + 1.3) + 0.035 * sin(5.0 * th + 0.4) + 0.02 * sin(11.0 * th + 2.1);
  float n = 2.6;
  return pow(pow(abs(a), n) + pow(abs(b), n), 1.0 / n) / wob;
}
float winVal(vec3 p) {
  if (dot(p - uWinC, uWinD) < 0.0) return 9.0; // only the half of the body facing the viewer is opened
  return winShape(p);
}`;
const PULSE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uDir;
uniform float uNeedle;
uniform vec3 uE;
uniform vec3 uT;
varying float vFlow;
varying vec3 vLocal;
float segDist(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + t * ab));
}`;

type Uniforms = Record<string, THREE.IUniform>;

const SKIN_GLSL = /* glsl */ `
uniform sampler2D uSkinTex;
uniform float uSkinScale;
varying vec3 vObjPos;
varying vec3 vObjN;
vec4 skinTri(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(uSkinTex, p.yz * uSkinScale) * w.x + texture2D(uSkinTex, p.xz * uSkinScale) * w.y + texture2D(uSkinTex, p.xy * uSkinScale) * w.z;
}`;

/** Tileable skin detail, generated once: rgb = tone variation (0.5 = neutral), a = micro-relief height. */
function makeSkinTexture(N = 256): THREE.DataTexture {
  const hash = (x: number, y: number, s: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const noise = (u: number, v: number, period: number, seed: number) => {
    const x = u * period;
    const y = v * period;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const v = j / N;
      const blotch = noise(u, v, 4, 1) * 0.6 + noise(u, v, 9, 2) * 0.4; // broad tone variation
      const mottle = noise(u, v, 24, 3); // small mottling, slightly redder
      const pores = noise(u, v, 96, 4) * 0.6 + noise(u, v, 48, 5) * 0.4; // micro-relief
      const t = 0.5 + (blotch - 0.5) * 0.55 + (mottle - 0.5) * 0.25;
      const o = (j * N + i) * 4;
      data[o] = Math.round(255 * Math.min(1, Math.max(0, t + (mottle - 0.5) * 0.12)));
      data[o + 1] = Math.round(255 * Math.min(1, Math.max(0, t)));
      data[o + 2] = Math.round(255 * Math.min(1, Math.max(0, t - (mottle - 0.5) * 0.05)));
      data[o + 3] = Math.round(255 * pores);
    }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera();
  readonly world = new THREE.Group();
  readonly orient = new THREE.Group();
  readonly patient = new THREE.Group();
  readonly meshes: Record<string, THREE.Mesh> = {};
  private room = new THREE.Group();
  private needle = new THREE.Group();
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private raycaster = new THREE.Raycaster();
  private bodyExtent = new THREE.Vector3(330, 250, 300);
  private torsoCenter = new THREE.Vector3();
  private torsoBox = new THREE.Box3();
  private bodyInfo: { floorZ: number; headTopZ: number } | null = null;
  private roomFloorY = NaN;
  private skinMat: THREE.ShaderMaterial | null = null;
  private noduleMat: THREE.MeshStandardMaterial | null = null;
  private windowU: Uniforms = {
    uWinC: { value: new THREE.Vector3() },
    uWinD: { value: new THREE.Vector3(0, 0, 1) },
    uWinR: { value: new THREE.Vector3(1, 0, 0) },
    uWinU: { value: new THREE.Vector3(0, 1, 0) },
    uWinRad: { value: new THREE.Vector2(100, 100) },
    uTorsoX: { value: new THREE.Vector2(0, 1e5) }, // torso centre x and half-width (patient mm)
  };
  private pulseU: Uniforms = {
    uTime: { value: 0 },
    uNeedle: { value: 0 },
    uE: { value: new THREE.Vector3() },
    uT: { value: new THREE.Vector3() },
  };
  private winRadiusLPS = new THREE.Vector2(130, 115);
  private lineData: CenterLines | null = null;
  private segs = new Int32Array(0);
  private segKind = new Uint8Array(0);
  private dangerHalo: THREE.InstancedMesh;
  private alerts: Alerts = { fissures: [], organs: [] };
  private layerState: Partial<Record<LayerName, LayerState>> = {};
  proximity: ProximityStats = { danger: 0 };

  head = new THREE.Vector3(0, 0, 620);
  private lookYaw = 0;
  private lookPitch = 0;
  private lookZoom = 1;
  private tLookYaw = 0;
  private tLookPitch = 0;
  private tLookZoom = 1;
  screen: ScreenConfig = { widthMm: 301, cameraOffsetMm: 8 };
  Wmm = 300;
  Hmm = 190;
  boxDepth = 380;
  yaw = 0;
  pitch = 0;
  targetYaw = 0;
  targetPitch = 0;
  zoom = 1;
  targetZoom = 1;
  paused = false;
  private skinTex: THREE.DataTexture | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps skin and blood hues true
    this.renderer.toneMappingExposure = 1.0;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;

    // studio lighting: key from the side and above (shows form), cool fill, white rim from behind
    this.scene.add(new THREE.HemisphereLight(0xf2f0ec, 0x0c0d10, 0.5));
    const key = new THREE.DirectionalLight(0xfff1e6, 2.5);
    key.position.set(-560, 640, 300);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9dcff, 0.45);
    fill.position.set(480, -60, 420);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.0);
    rim.position.set(120, 300, -700);
    this.scene.add(rim);
    this.skinTex = makeSkinTexture();

    this.orient.rotation.x = -Math.PI / 2; // LPS (x, y, z) -> display (x, z, -y)
    this.orient.add(this.patient);
    this.world.add(this.orient);
    this.patient.add(this.needle);
    this.scene.add(this.world, this.room);

    this.dangerHalo = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 12, 1, false),
      new THREE.MeshBasicMaterial({ color: '#ff2d55', transparent: true, opacity: 0.3, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
      800,
    );
    this.dangerHalo.count = 0;
    this.dangerHalo.frustumCulled = false;
    this.dangerHalo.renderOrder = 31;
    this.patient.add(this.dangerHalo);

    this.resize();
    this.installPointer();
    window.addEventListener('resize', this.resize);
    this.loop(0);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ anatomy
  async loadAnatomy(url: string, body?: { floorZ: number; headTopZ: number }) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const found: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
    });
    for (const m of found) {
      const name = m.name || m.parent?.name || 'part';
      if (name === 'emphysema') continue;
      m.updateWorldMatrix(true, false);
      const g = (m.geometry as THREE.BufferGeometry).clone().applyMatrix4(m.matrixWorld);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.materialFor(name, g));
      mesh.name = name;
      mesh.renderOrder = this.renderOrderFor(name);
      if (name === 'skin' || name === 'airways') mesh.visible = false;
      if (name === 'body' || name === 'skin') g.computeBoundsTree();
      this.meshes[name] = mesh;
      this.patient.add(mesh);
      if (name === 'body') {
        // layered cut edge like an anatomical dissection: skin, then fat, then chest-wall muscle
        const layers: [number, number, string, string][] = [
          [4, 0.972, '#e3c27f', '#f1dba6'],
          [11, 0.942, '#8a2e2b', '#a6443d'],
        ];
        for (const [inset, open, color, rim] of layers) {
          const lm = new THREE.Mesh(
            g,
            this.patch(new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.35, side: THREE.DoubleSide }), { window: true, cavity: true, inset, open, rim }),
          );
          lm.name = `body_layer_${inset}`;
          this.patient.add(lm);
        }
      }
    }
    const skin = this.meshes['skin'];
    if (skin) {
      skin.geometry.computeBoundingBox();
      this.torsoBox.copy(skin.geometry.boundingBox!);
      this.torsoBox.getCenter(this.torsoCenter);
      this.torsoBox.getSize(this.bodyExtent);
      this.patient.position.set(-this.torsoCenter.x, -this.torsoCenter.y, -this.torsoCenter.z);
      // the window stays inside the scanned range, so cut ends of the CT anatomy never show
      this.winRadiusLPS.set(Math.min(140, this.bodyExtent.x * 0.4), Math.max(60, this.bodyExtent.z / 2 - 30));
      (this.windowU.uTorsoX.value as THREE.Vector2).set(this.torsoCenter.x, this.bodyExtent.x / 2 - 4);
    }
    this.bodyInfo = body ?? null;
    this.fitScale();
    // compile every shader now (including the needle's) so the first aim doesn't hitch for ~200 ms
    const c = this.torsoCenter;
    const at: Vec3 = [c.x, c.y, c.z];
    this.setNeedle({ entry: [c.x, c.y + 150, c.z], target: at, color: '#ffffff', markers: [{ p: at, kind: 'pleura' }, { p: at, kind: 'blocker' }] });
    this.renderer.compile(this.scene, this.camera);
    this.setNeedle(null);
  }

  private patch(mat: THREE.Material, opts: { window?: boolean; pulse?: number; cavity?: boolean; inset?: number; open?: number; rim?: string; skin?: boolean }) {
    mat.onBeforeCompile = (shader) => {
      if (opts.window) Object.assign(shader.uniforms, this.windowU);
      if (opts.skin) Object.assign(shader.uniforms, { uSkinTex: { value: this.skinTex }, uSkinScale: { value: 1 / 110 } });
      if (opts.pulse !== undefined) Object.assign(shader.uniforms, this.pulseU, { uDir: { value: opts.pulse } });
      let vs = shader.vertexShader;
      let fs = shader.fragmentShader;
      const pv = opts.pulse !== undefined;
      vs = vs.replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nvarying float vPatX;' + (opts.skin ? '\nvarying vec3 vObjPos;\nvarying vec3 vObjN;' : '') + (pv ? '\nattribute float aFlow;\nvarying float vFlow;\nvarying vec3 vLocal;' : ''));
      if (opts.inset) vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed -= normal * ${opts.inset.toFixed(1)};`);
      vs = vs.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPatX = position.x;' + (opts.skin ? '\nvObjPos = position;\nvObjN = normal;' : '') + (pv ? '\nvFlow = aFlow;\nvLocal = position;' : ''),
      );
      fs = fs.replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nvarying float vPatX;\nuniform vec2 uTorsoX;\n' + (opts.window ? WINDOW_GLSL : '') + (pv ? PULSE_GLSL : '') + (opts.skin ? SKIN_GLSL : ''));
      const open = (opts.open ?? 1).toFixed(3);
      // The torso is opened on the side facing you. An arm that crosses the window (steep side views) is
      // hidden entirely there, so it neither blocks the view nor shows a sliced cross-section.
      if (opts.window)
        fs = fs.replace(
          'void main() {',
          `void main() {
  bool torso = abs(vPatX - uTorsoX.x) < uTorsoX.y;
  float winE = torso ? winVal(vWorldP) / ${open} : 9.0;
  if (winE < 1.0) discard;
  if (!torso && winShape(vWorldP) < 1.0) discard;`,
        );
      let colorExtra = '';
      if (opts.skin) colorExtra += '\nvec4 sk = skinTri(vObjPos, normalize(vObjN));\ndiffuseColor.rgb *= vec3(0.84 + 0.32 * sk.r, 0.87 + 0.26 * sk.g, 0.88 + 0.24 * sk.b);';
      if (opts.cavity) colorExtra += '\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.24, 0.09, 0.085);';
      if (colorExtra) fs = fs.replace('#include <color_fragment>', '#include <color_fragment>' + colorExtra);
      if (opts.skin) {
        fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.82 + 0.4 * sk.a), 0.0, 1.0);');
        fs = fs.replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec2 dh = vec2(dFdx(sk.a), dFdy(sk.a)) * 0.07;
            vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
            vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
            float det = dot(sx, r1) * faceDirection;
            normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
          }`,
        );
        fs = fs.replace(
          '#include <opaque_fragment>',
          `{ float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
             if (gl_FrontFacing) outgoingLight += vec3(0.61, 0.27, 0.2) * (0.012 + 0.14 * pow(1.0 - ndv, 2.5)); }
          #include <opaque_fragment>`,
        );
      }
      if (pv)
        fs = fs.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float ph = fract((vFlow - uDir * uTime * 0.045) / 80.0);
          float pulse = vFlow < 0.0 ? 0.0 : smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(0.04, 0.22, ph));
          totalEmissiveRadiance += diffuseColor.rgb * pulse * 0.7;
          if (uNeedle > 0.5) {
            float d = segDist(vLocal, uE, uT);
            float blink = 0.5 + 0.5 * sin(uTime * 0.0045);
            if (d < 2.0) {
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.33, 0.36), 0.7);
              totalEmissiveRadiance += vec3(0.5, 0.08, 0.1) * (0.08 + 0.22 * blink);
            } else if (d < 5.0) {
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.70, 0.32), 0.45);
            }
          }`,
        );
      if (opts.window)
        fs = fs.replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>\nif (gl_FrontFacing && winE < 1.012) gl_FragColor.rgb = mix(vec3(${new THREE.Color(opts.rim ?? '#f1d9c9').toArray().map((v) => v.toFixed(3)).join(',')}), gl_FragColor.rgb, (winE - 1.0) / 0.012);`,
        );
      shader.vertexShader = vs;
      shader.fragmentShader = fs;
    };
    mat.needsUpdate = true;
    return mat;
  }

  private materialFor(name: string, g: THREE.BufferGeometry): THREE.Material {
    if (name === 'body')
      return this.patch(
        new THREE.MeshPhysicalMaterial({
          color: '#c9a896',
          roughness: 0.6,
          metalness: 0,
          sheen: 0.3,
          sheenColor: new THREE.Color('#ffd9c6'),
          sheenRoughness: 0.7,
          specularIntensity: 0.4,
          side: THREE.DoubleSide,
        }),
        { window: true, cavity: true, skin: true },
      );
    if (name === 'skin') {
      const n = g.getAttribute('position').count;
      g.setAttribute('riskColor', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
      this.skinMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        uniforms: { ...this.windowU },
        vertexShader: `attribute vec4 riskColor; varying vec4 vC; varying vec3 vWorldP;
          void main(){ vC = riskColor; vWorldP = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `${WINDOW_GLSL}\nvarying vec4 vC; varying vec3 vWorldP;
          void main(){ if (winVal(vWorldP) < 1.0) discard; gl_FragColor = vec4(vC.rgb, vC.a * 0.85); }`,
      });
      return this.skinMat;
    }
    if (name === 'arteries' || name === 'veins' || name === 'airways') {
      const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
      const n = g.getAttribute('position').count;
      const flow = new Float32Array(n).fill(-1);
      if (col) {
        // pipeline packs flow (0.1 mm units) into R (high byte) and G (low byte); B = 255 when unknown
        for (let i = 0; i < n; i++) {
          const r = Math.round(col.getX(i) * 255);
          const gg = Math.round(col.getY(i) * 255);
          const b = Math.round(col.getZ(i) * 255);
          flow[i] = b > 200 ? -1 : (r * 256 + gg) / 10;
        }
        g.deleteAttribute('color');
      }
      g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
      const color = name === 'arteries' ? '#3352a8' : name === 'veins' ? '#a8323f' : '#cfdbe6';
      return this.patch(
        new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.3, transparent: true, opacity: BASE_OPACITY[name], depthWrite: name !== 'airways' }),
        { pulse: name === 'arteries' ? 1 : name === 'veins' ? -1 : 0.4 },
      );
    }
    if (LOBES.includes(name))
      return new THREE.MeshPhysicalMaterial({ color: '#f0b9bd', transparent: true, opacity: BASE_OPACITY.lobe, depthWrite: false, roughness: 0.2, clearcoat: 1 });
    if (FISSURES.includes(name))
      return new THREE.MeshBasicMaterial({ color: '#8ee6d8', transparent: true, opacity: BASE_OPACITY.fissure, side: THREE.DoubleSide, depthWrite: false });
    const std = (color: string, opacity = 1, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, ...extra });
    switch (name) {
      case 'ribs':
      case 'scapulae':
      case 'spine':
        return new THREE.MeshPhysicalMaterial({ color: '#dccbab', roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.55 });
      case 'heart':
        return new THREE.MeshPhysicalMaterial({ color: '#8f1f2c', roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.25, transparent: true, opacity: BASE_OPACITY.heart, emissive: new THREE.Color('#1c0306') });
      case 'great_vessels':
        return new THREE.MeshPhysicalMaterial({ color: '#a82d3a', roughness: 0.3, clearcoat: 0.7, transparent: true, opacity: BASE_OPACITY.great_vessels, emissive: new THREE.Color('#1c0306') });
      case 'nodule':
        this.noduleMat = std('#e8a33d', 1, { emissive: new THREE.Color('#d0780c'), emissiveIntensity: 0.7, roughness: 0.35 });
        return this.noduleMat;
      default:
        return std('#aaaaaa');
    }
  }

  private renderOrderFor(name: string) {
    if (name === 'skin') return 12;
    if (LOBES.includes(name)) return 6;
    if (FISSURES.includes(name)) return 7;
    if (name === 'heart' || name === 'great_vessels' || name === 'airways') return 4;
    if (name === 'arteries' || name === 'veins') return 3;
    return 0;
  }

  /** Centrelines drive the "may be hit" glow that stays visible through bone. */
  setCenterlines(lines: CenterLines | null) {
    if (!lines) return;
    this.lineData = lines;
    let nSeg = 0;
    for (const [, , c] of lines.branches) nSeg += Math.max(0, c - 1);
    this.segs = new Int32Array(nSeg);
    this.segKind = new Uint8Array(nSeg);
    let s = 0;
    for (const [k, start, count] of lines.branches)
      for (let i = start; i < start + count - 1; i++) {
        this.segs[s] = i;
        this.segKind[s++] = k;
      }
  }

  setLayer(name: LayerName, s: LayerState) {
    this.layerState[name] = s;
    if (name === 'vessels') this.dangerHalo.visible = s.visible;
    for (const n of GROUPS[name]) {
      const m = this.meshes[n];
      if (!m) continue;
      m.visible = s.visible && s.opacity > 0.01;
      const mat = m.material as THREE.Material & { opacity?: number };
      if (mat.opacity === undefined || n === 'skin') continue;
      const base = this.baseOpacity(n);
      mat.opacity = base * s.opacity;
      mat.transparent = mat.opacity < 0.999 || base < 1;
    }
  }

  private baseOpacity(n: string) {
    if (LOBES.includes(n)) return BASE_OPACITY.lobe;
    if (FISSURES.includes(n)) return BASE_OPACITY.fissure;
    return BASE_OPACITY[n] ?? 1;
  }

  hasLayer(name: LayerName) {
    return GROUPS[name].some((n) => this.meshes[n]);
  }

  setSkinRisk(colors: Float32Array) {
    const skin = this.meshes['skin'];
    if (!skin) return;
    const attr = skin.geometry.getAttribute('riskColor') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(colors);
    attr.needsUpdate = true;
  }

  skinVertices(): Float32Array | null {
    const skin = this.meshes['skin'];
    return skin ? (skin.geometry.getAttribute('position').array as Float32Array) : null;
  }

  skinNormals(): Float32Array | null {
    const skin = this.meshes['skin'];
    return skin ? (skin.geometry.getAttribute('normal').array as Float32Array) : null;
  }

  setAlerts(a: Alerts) {
    this.alerts = a;
    for (const n of [...FISSURES, 'heart', 'great_vessels']) {
      const m = this.meshes[n];
      if (!m) continue;
      const mat = m.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
      if (!(a.fissures.includes(n) || a.organs.includes(n))) {
        mat.opacity = this.baseOpacity(n) * this.layerOpacity(n);
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = 1;
        if (FISSURES.includes(n)) (mat as THREE.MeshBasicMaterial).color.set('#8ee6d8');
      } else if (FISSURES.includes(n)) (mat as THREE.MeshBasicMaterial).color.set('#f08a8a');
    }
  }

  private layerOpacity(n: string) {
    for (const [layer, names] of Object.entries(GROUPS)) {
      if (names.includes(n)) {
        const s = this.layerState[layer as LayerName];
        return s ? (s.visible ? s.opacity : 0) : 1;
      }
    }
    return 1;
  }

  // ------------------------------------------------------------------ needle
  setNeedle(spec: NeedleSpec | null) {
    this.needle.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && !SHARED_NEEDLE_MATS.has(mat)) mat.dispose();
    });
    this.needle.clear();
    if (!spec) {
      this.pulseU.uNeedle.value = 0;
      this.updateDanger(null, null);
      return;
    }
    this.pulseU.uNeedle.value = 1;
    (this.pulseU.uE.value as THREE.Vector3).set(...spec.entry);
    (this.pulseU.uT.value as THREE.Vector3).set(...spec.target);
    const e = new THREE.Vector3(...spec.entry);
    const t = new THREE.Vector3(...spec.target);
    const dir = t.clone().sub(e).normalize();
    const color = new THREE.Color(spec.color);
    this.needle.add(buildNeedle(e, t, color));
    const ghost = this.cylinder(e, t, 0.5, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, depthTest: false }));
    ghost.renderOrder = 30;
    this.needle.add(ghost);
    const hubEnd = e.clone().addScaledVector(dir, -48);
    if (spec.outer) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...spec.outer), hubEnd]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 6, gapSize: 5, transparent: true, opacity: 0.5 }));
      line.computeLineDistances();
      this.needle.add(line);
    }
    for (const mk of spec.markers) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(mk.kind === 'blocker' ? 3.5 : 1.8, 16, 12),
        new THREE.MeshBasicMaterial({ color: mk.kind === 'blocker' ? '#ff2d55' : '#ffffff', depthTest: mk.kind !== 'blocker' }),
      );
      s.position.set(...mk.p);
      s.renderOrder = 32;
      this.needle.add(s);
    }
    this.updateDanger(spec.entry, spec.target);
  }

  private cylinder(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
    const d = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 16, 1, true), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.renderOrder = 20;
    return m;
  }

  /** Glow (visible through bone) on vessel segments the needle passes within 2 mm of. */
  private updateDanger(entry: Vec3 | null, target: Vec3 | null) {
    const halo = this.dangerHalo;
    halo.count = 0;
    this.proximity = { danger: 0 };
    const L = this.lineData;
    if (entry && target && L) {
      const P = L.pts;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      for (let s = 0; s < this.segs.length; s++) {
        if (this.segKind[s] === 2) continue;
        const i = this.segs[s] * 5;
        const j = i + 5;
        const r = Math.max(P[i + 3], P[j + 3]);
        const a: Vec3 = [P[i], P[i + 1], P[i + 2]];
        const b: Vec3 = [P[j], P[j + 1], P[j + 2]];
        if (segSegDistance(entry, target, a, b) - r >= 2) continue;
        const va = new THREE.Vector3(...a);
        const vb = new THREE.Vector3(...b);
        const d = vb.clone().sub(va);
        const len = d.length();
        q.setFromUnitVectors(up, d.normalize());
        const hr = Math.max(r * 2.2, 2.5);
        m.compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(hr, len + hr, hr));
        if (halo.count < 800) halo.setMatrixAt(halo.count++, m);
        this.proximity.danger++;
      }
    }
    halo.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ interaction helpers
  /** Raycast the body under a client pixel; returns an LPS point on the surface. */
  pickSkin(clientX: number, clientY: number): Vec3 | null {
    const body = this.meshes['body'] ?? this.meshes['skin'];
    if (!body) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(body, false)[0];
    if (!hit) return null;
    const p = this.patient.worldToLocal(hit.point.clone());
    return [p.x, p.y, p.z];
  }

  glassToLPS(nx: number, ny: number, zMm = 0): Vec3 {
    const p = new THREE.Vector3((nx * this.Wmm) / 2, (ny * this.Hmm) / 2, zMm);
    this.patient.worldToLocal(p);
    return [p.x, p.y, p.z];
  }

  face(side: 'anterior' | 'posterior' | 'left' | 'right') {
    const yaw = { anterior: 0, posterior: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }[side];
    let d = yaw - this.targetYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.targetYaw += d;
    this.targetPitch = 0;
  }

  faceDirection(u: Vec3) {
    const yaw = Math.atan2(-u[0], -u[1]);
    let d = yaw - this.targetYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.targetYaw += d;
  }

  setFraming(f: 'chest' | 'body') {
    this.targetZoom = f === 'chest' ? 1 : this.fullBodyZoom();
  }

  get framing(): 'chest' | 'body' {
    return this.targetZoom < 0.6 ? 'body' : 'chest';
  }

  private fullBodyZoom() {
    if (!this.bodyInfo) return 0.6;
    const e = this.bodyExtent;
    const sChest = Math.min((0.4 * this.Wmm) / e.x, (0.7 * this.Hmm) / e.z);
    return (0.9 * this.Hmm) / (this.bodyInfo.headTopZ - this.bodyInfo.floorZ) / sChest;
  }

  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }

  // ------------------------------------------------------------------ head-coupled camera
  setHead(x: number, y: number, z: number) {
    this.head.set(x, y, Math.max(150, z));
  }

  /**
   * Head offset from where the viewer started (mm; x right, y up, z away from the screen).
   *  - The window projection follows your REAL head position (gain 1, clamped). An off-axis projection is
   *    only undistorted when the virtual eye is where your eye actually is; amplifying it shears the image
   *    and stretches anything near the screen plane.
   *  - The extra "look around" comes from turning the patient about the chest (a rigid rotation: no
   *    distortion). The turn accelerates with distance: gentle near the centre, up to ±50° left/right
   *    and ±25° up/down.
   *  - Leaning in zooms in.
   */
  setHeadOffset(dx: number, dy: number, dz: number) {
    const cl = (v: number) => Math.max(-1, Math.min(1, v));
    this.setHead(cl(dx / 200) * 200, cl(dy / 140) * 140, 620 + dz);
    this.tLookYaw = -cl(dx / 170) * ((50 * Math.PI) / 180);
    this.tLookPitch = cl(dy / 140) * ((25 * Math.PI) / 180);
    this.tLookZoom = Math.max(0.7, Math.min(1.9, Math.pow(620 / Math.max(250, 620 + dz * 1.4), 1.6)));
  }

  clearHead() {
    this.setHead(0, 0, 620);
    this.tLookYaw = this.tLookPitch = 0;
    this.tLookZoom = 1;
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const mmPerPx = this.screen.widthMm / (window.screen.width || w);
    this.Wmm = w * mmPerPx;
    this.Hmm = h * mmPerPx;
    this.roomFloorY = NaN;
    this.fitScale();
  };

  setScreen(cfg: Partial<ScreenConfig>) {
    this.screen = { ...this.screen, ...cfg };
    this.resize();
  }

  private fitScale() {
    const e = this.bodyExtent;
    const sChest = Math.min((0.4 * this.Wmm) / e.x, (0.7 * this.Hmm) / e.z);
    const s = sChest * this.zoom * this.lookZoom;
    this.orient.scale.setScalar(s);
    let focusZ = this.torsoCenter.z;
    let floorZ = this.torsoCenter.z - e.z / 2 - 40;
    if (this.bodyInfo) {
      const full = this.fullBodyZoom();
      const f = Math.max(0, Math.min(1, (1 - this.zoom) / Math.max(1e-3, 1 - full)));
      focusZ = this.torsoCenter.z + ((this.bodyInfo.floorZ + this.bodyInfo.headTopZ) / 2 - this.torsoCenter.z) * f;
      floorZ = this.bodyInfo.floorZ;
    }
    const y = -(focusZ - this.torsoCenter.z) * s - this.Hmm * 0.03;
    this.world.position.set(0, y, 0);
    const floorY = y + (floorZ - this.torsoCenter.z) * s;
    if (!(Math.abs(floorY - this.roomFloorY) < 0.5)) this.buildRoom(floorY);
  }

  private buildRoom(floorY: number) {
    this.roomFloorY = floorY;
    for (const c of [...this.room.children]) {
      this.room.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const W = this.Wmm / 2;
    const top = this.Hmm / 2;
    const bot = Math.min(floorY, -this.Hmm / 2);
    const D = this.boxDepth;
    const pts: number[] = [];
    const seg = (a: number[], b: number[]) => pts.push(...a, ...b);
    const g = 25;
    for (let z = 0; z >= -D; z -= g) {
      seg([-W, bot, z], [W, bot, z]);
      seg([-W, bot, z], [-W, top, z]);
      seg([W, bot, z], [W, top, z]);
    }
    for (let x = -W; x <= W + 0.1; x += g) {
      seg([x, bot, 0], [x, bot, -D]);
      seg([x, bot, -D], [x, top, -D]);
    }
    for (let y = top; y >= bot - 0.1; y -= g) {
      seg([-W, y, 0], [-W, y, -D]);
      seg([W, y, 0], [W, y, -D]);
      seg([-W, y, -D], [W, y, -D]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false }));
    lines.renderOrder = -1;
    this.room.add(lines);
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(Math.min(W, D / 2) * 0.75, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, bot + 0.5, -this.boxDepth * 0.35);
    this.room.add(pool);
  }

  private updateProjection() {
    const { x: hx, y: hy, z: hz } = this.head;
    const near = 5;
    const k = near / hz;
    this.camera.position.set(hx, hy, hz);
    this.camera.quaternion.identity();
    this.camera.updateMatrixWorld(true);
    this.camera.projectionMatrix.makePerspective((-this.Wmm / 2 - hx) * k, (this.Wmm / 2 - hx) * k, (this.Hmm / 2 - hy) * k, (-this.Hmm / 2 - hy) * k, near, 8000);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  /** The skin window faces the viewer: centred on the chest, opened on the side toward the camera. */
  private updateWindow() {
    const c = this.patient.localToWorld(this.torsoCenter.clone());
    const d = this.camera.position.clone().sub(c).normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();
    const right = new THREE.Vector3().crossVectors(up, d).normalize();
    const s = this.orient.scale.x;
    (this.windowU.uWinC.value as THREE.Vector3).copy(c);
    (this.windowU.uWinD.value as THREE.Vector3).copy(d);
    (this.windowU.uWinR.value as THREE.Vector3).copy(right);
    (this.windowU.uWinU.value as THREE.Vector3).copy(up);
    (this.windowU.uWinRad.value as THREE.Vector2).set(this.winRadiusLPS.x * s, this.winRadiusLPS.y * s);
  }

  // ------------------------------------------------------------------ mouse turntable
  private installPointer() {
    let dragging = false;
    let lx = 0;
    let ly = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 && !e.shiftKey) return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.targetYaw += (e.clientX - lx) * 0.008;
      this.targetPitch = Math.max(-0.6, Math.min(0.6, this.targetPitch + (e.clientY - ly) * 0.005));
      lx = e.clientX;
      ly = e.clientY;
    });
    const end = () => (dragging = false);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const min = Math.min(0.5, this.fullBodyZoom() * 0.95);
        this.targetZoom = Math.max(min, Math.min(2.4, this.targetZoom * Math.exp(-e.deltaY * 0.0012)));
      },
      { passive: false },
    );
  }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    this.yaw += (this.targetYaw - this.yaw) * 0.12;
    this.pitch += (this.targetPitch - this.pitch) * 0.12;
    this.lookYaw += (this.tLookYaw - this.lookYaw) * 0.18;
    this.lookPitch += (this.tLookPitch - this.lookPitch) * 0.18;
    const zPrev = this.zoom * this.lookZoom;
    this.zoom += (this.targetZoom - this.zoom) * 0.14;
    this.lookZoom += (this.tLookZoom - this.lookZoom) * 0.15;
    if (Math.abs(this.zoom * this.lookZoom - zPrev) > 1e-4) this.fitScale();
    this.world.rotation.set(this.pitch + this.lookPitch, this.yaw + this.lookYaw, 0, 'YXZ');
    const blink = 0.5 + 0.5 * Math.sin(t * 0.011);
    this.pulseU.uTime.value = t;
    if (this.noduleMat) this.noduleMat.emissiveIntensity = 0.5 + 0.4 * Math.sin(t * 0.004);
    const slow = 0.5 + 0.5 * Math.sin(t * 0.0045);
    (this.dangerHalo.material as THREE.MeshBasicMaterial).opacity = 0.03 + 0.08 * slow;
    for (const n of this.alerts.fissures) {
      const m = this.meshes[n];
      if (m) (m.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.22 * slow;
    }
    for (const n of this.alerts.organs) {
      const m = this.meshes[n];
      if (m) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 + 1.2 * slow;
    }
    void blink;
    if (this.paused) return;
    this.updateProjection();
    this.world.updateMatrixWorld(true);
    this.updateWindow();
    this.renderer.render(this.scene, this.camera);
  };
}

/** Shortest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
function segSegDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
  const d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) return Math.hypot(r[0], r[1], r[2]);
  if (a <= 1e-9) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= 1e-9) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
      const den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return Math.hypot(p1[0] + d1[0] * s - (p2[0] + d2[0] * t), p1[1] + d1[1] * s - (p2[1] + d2[1] * t), p1[2] + d1[2] * s - (p2[2] + d2[2] * t));
}

/** A coaxial biopsy needle: bevelled stainless shaft with 1 cm depth marks, Luer hub, stylet cap, grip wings.
 *  Built along +Y from the tip (at the target) back out through the entry point. */
const SHARED_NEEDLE_MATS = new Set<THREE.Material>();
let needleMats: Record<'steel' | 'mark' | 'hub' | 'wings' | 'cap', THREE.Material> | null = null;
function getNeedleMats() {
  if (!needleMats) {
    needleMats = {
      steel: new THREE.MeshStandardMaterial({ color: '#e9edf1', metalness: 1, roughness: 0.22 }),
      mark: new THREE.MeshStandardMaterial({ color: '#2a3138', roughness: 0.6 }),
      hub: new THREE.MeshStandardMaterial({ color: '#d9d9d9', roughness: 0.3, transparent: true, opacity: 0.9 }),
      wings: new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.4 }),
      cap: new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.35 }),
    };
    Object.values(needleMats).forEach((m) => SHARED_NEEDLE_MATS.add(m));
  }
  return needleMats;
}

function buildNeedle(entry: THREE.Vector3, tip: THREE.Vector3, accent: THREE.Color) {
  const M = getNeedleMats();
  const g = new THREE.Group();
  const L = entry.distanceTo(tip);
  const outside = 15; // shaft visible above the skin before the hub
  const r = 0.6;
  const steel = M.steel;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L + outside - 3, 24), steel);
  shaft.position.y = 3 + (L + outside - 3) / 2;
  g.add(shaft);
  const bevel = new THREE.Mesh(new THREE.ConeGeometry(r, 3, 24), steel);
  bevel.rotation.z = Math.PI;
  bevel.position.y = 1.5;
  g.add(bevel);
  const markDark = M.mark;
  for (let d = 10; d < L + outside - 2; d += 10) {
    const big = d % 50 === 0;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, big ? 1.1 : 0.45, 24), markDark);
    ring.position.y = d;
    g.add(ring);
  }
  const hubY = L + outside;
  const prof = [
    [r * 1.1, 0], [2.0, 2], [2.4, 7], [3.3, 9], [3.3, 21], [2.7, 23], [2.7, 28], [0.01, 28],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const hub = new THREE.Mesh(
    new THREE.LatheGeometry(prof, 40),
    M.hub,
  );
  hub.position.y = hubY;
  g.add(hub);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(15, 1.1, 5), M.wings);
  wings.position.y = hubY + 9.5;
  g.add(wings);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 6, 32), M.cap);
  cap.position.y = hubY + 31;
  g.add(cap);
  const entryRing = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.35, 10, 40), new THREE.MeshBasicMaterial({ color: accent }));
  entryRing.rotation.x = Math.PI / 2;
  entryRing.position.y = L;
  g.add(entryRing);
  g.position.copy(tip);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), entry.clone().sub(tip).normalize());
  g.traverse((o) => (o.renderOrder = 20));
  return g;
}
