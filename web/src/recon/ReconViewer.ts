// 3D view for the reconstruction walkthrough: orbitable patient anatomy with the live CT slice drawn as a
// plane through the model, so every structure can be checked against the image it came from.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Vec3 } from '../engine/types';
import type { Plane } from './CtPanel';

export const PART_COLORS: Record<string, string> = {
  skin: '#d6bba8',
  ribs: '#eee4cf',
  scapulae: '#d9c9a3',
  spine: '#c9d6e8',
  lung_upper_lobe_right: '#7fb3e8',
  lung_middle_lobe_right: '#b59be8',
  lung_lower_lobe_right: '#72d1b5',
  lung_upper_lobe_left: '#e8b07f',
  lung_lower_lobe_left: '#e8d27f',
  right_oblique_fissure: '#ff8a8a',
  right_horizontal_fissure: '#ffb3e1',
  left_oblique_fissure: '#ff8a8a',
  heart: '#b3303f',
  great_vessels: '#e0606e',
  airways: '#9fe0f0',
  arteries: '#3e6fd6',
  veins: '#c4405a',
  nodule: '#e8a33d',
  emphysema: '#a26bff',
};

export class ReconViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 5, 6000);
  private controls: OrbitControls;
  private patient = new THREE.Group();
  private meshes: Record<string, THREE.Mesh> = {};
  private plane: THREE.Mesh;
  private planeTex: THREE.CanvasTexture | null = null;
  private marker: THREE.Mesh;
  private raf = 0;
  private center = new THREE.Vector3();
  private canvas: HTMLCanvasElement;
  private ro: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(300, 500, 700);
    this.scene.add(key);
    const orient = new THREE.Group();
    orient.rotation.x = -Math.PI / 2; // LPS -> display
    orient.add(this.patient);
    this.scene.add(orient);
    this.camera.position.set(560, 420, 900); // three-quarter view so the CT plane is seen at an angle
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    this.plane = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.plane.renderOrder = 5;
    this.patient.add(this.plane);
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(3.5, 20, 14), new THREE.MeshBasicMaterial({ color: '#e8a33d', depthTest: false }));
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.patient.add(this.marker);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }

  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = m.name || m.parent?.name || '';
      if (name === 'body') return; // the stylised outer body is not patient data
      m.updateWorldMatrix(true, false);
      const g = (m.geometry as THREE.BufferGeometry).clone().applyMatrix4(m.matrixWorld);
      g.deleteAttribute('color');
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const glassy = name === 'skin' || name.startsWith('lung_') || name.includes('fissure');
      const mat = new THREE.MeshPhysicalMaterial({
        color: PART_COLORS[name] ?? '#aaaaaa',
        roughness: 0.4,
        clearcoat: 0.4,
        transparent: true,
        opacity: glassy ? 0.25 : 1,
        depthWrite: !glassy,
        side: name.includes('fissure') ? THREE.DoubleSide : THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.visible = false;
      this.meshes[name] = mesh;
      this.patient.add(mesh);
    });
    const skin = this.meshes['skin'];
    if (skin) {
      skin.geometry.computeBoundingBox();
      skin.geometry.boundingBox!.getCenter(this.center);
      this.patient.position.set(-this.center.x, -this.center.y, -this.center.z);
    }
  }

  has(name: string) {
    return !!this.meshes[name];
  }

  /** current: shown solid; context: shown faint (earlier confirmed steps). */
  show(current: string[], context: string[]) {
    for (const [name, m] of Object.entries(this.meshes)) {
      const mat = m.material as THREE.MeshPhysicalMaterial;
      const cur = current.includes(name);
      const ctx = context.includes(name);
      m.visible = cur || ctx;
      const glassy = name === 'skin' || name.startsWith('lung_') || name.includes('fissure');
      mat.opacity = cur ? (glassy ? (name === 'skin' ? 0.22 : 0.45) : 1) : 0.07;
      const tr = mat.opacity < 1;
      if (tr !== mat.transparent) mat.needsUpdate = true; // blending mode change needs a recompile
      mat.transparent = tr;
      mat.depthWrite = !tr;
      mat.emissive.set('#000000');
    }
  }

  highlight(name: string | null) {
    for (const [n, m] of Object.entries(this.meshes)) {
      const mat = m.material as THREE.MeshPhysicalMaterial;
      mat.emissive.set(n === name ? PART_COLORS[n] ?? '#ffffff' : '#000000');
      mat.emissiveIntensity = n === name ? 0.55 : 0;
    }
  }

  /** Draw the CT image itself as a plane through the model. */
  setSlice(canvas: HTMLCanvasElement, plane: Plane, p: Vec3, grid: { origin: Vec3; spacing: number; dims: [number, number, number] }) {
    const [ox, oy, oz] = grid.origin;
    const sp = grid.spacing;
    const [nx, ny, nz] = grid.dims;
    const x1 = ox + (nx - 1) * sp;
    const y1 = oy + (ny - 1) * sp;
    const z1 = oz + (nz - 1) * sp;
    let c: Vec3[]; // top-left, top-right, bottom-left, bottom-right of the canvas
    if (plane === 'axial') c = [[ox, oy, p[2]], [x1, oy, p[2]], [ox, y1, p[2]], [x1, y1, p[2]]];
    else if (plane === 'coronal') c = [[ox, p[1], z1], [x1, p[1], z1], [ox, p[1], oz], [x1, p[1], oz]];
    else c = [[p[0], oy, z1], [p[0], y1, z1], [p[0], oy, oz], [p[0], y1, oz]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    this.plane.geometry.dispose();
    this.plane.geometry = g;
    if (!this.planeTex || this.planeTex.image !== canvas) {
      this.planeTex?.dispose();
      this.planeTex = new THREE.CanvasTexture(canvas);
      this.planeTex.flipY = false;
      this.planeTex.colorSpace = THREE.SRGBColorSpace;
      (this.plane.material as THREE.MeshBasicMaterial).map = this.planeTex;
      (this.plane.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
    this.planeTex.needsUpdate = true;
  }

  setPlaneVisible(v: boolean) {
    this.plane.visible = v;
  }

  setMarker(p: Vec3 | null) {
    this.marker.visible = !!p;
    if (p) this.marker.position.set(...p);
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
