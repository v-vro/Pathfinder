// Webcam head + hand tracking with MediaPipe Tasks (runs fully in the browser, GPU delegate).
//  - Head: eye midpoint from iris landmarks; distance from apparent inter-pupillary distance.
//    Output is in millimetres relative to the webcam (x right, y up, z toward the viewer).
//  - Hand: index fingertip as a pointer in normalised screen coords (-1..1, mirrored), pinch = thumb-index.
import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { OneEuro } from './oneEuro';

export interface HeadPose {
  x: number;
  y: number;
  z: number;
}

export interface HandPointer {
  nx: number; // -1 (left) .. 1 (right) of the screen, mirrored like a mirror
  ny: number; // -1 (bottom) .. 1 (top)
  pinch: boolean;
  depth: number; // relative hand size (bigger = closer to the screen/camera)
}

export interface TrackerOptions {
  face: boolean;
  hand: boolean;
  hfovDeg?: number; // horizontal field of view of the webcam
  ipdMm?: number;
}

const IPD_MM = 63;

export class Tracker {
  video: HTMLVideoElement;
  private face: FaceLandmarker | null = null;
  private hand: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private opts: Required<TrackerOptions> = { face: true, hand: true, hfovDeg: 62, ipdMm: IPD_MM };
  private fx = new OneEuro(1.0, 0.02);
  private fy = new OneEuro(1.0, 0.02);
  private fz = new OneEuro(0.6, 0.01);
  private hx = new OneEuro(0.7, 0.02);
  private hy = new OneEuro(0.7, 0.02);
  private pinchState = false;
  private frame = 0;

  onHead: ((p: HeadPose | null) => void) | null = null;
  onHand: ((h: HandPointer | null) => void) | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  private models: Promise<void> | null = null;
  private camera: Promise<void> | null = null;

  /**
   * Load both models and warm up their GPU shaders, without the camera. Called in the background when the
   * planner opens, so switching on Head or Hand only has to open the camera (first-time model load + shader
   * compile took ~5 s, which looked like "the hand isn't detected"). Safe to call repeatedly.
   */
  preload(): Promise<void> {
    if (!this.models) {
      this.models = (async () => {
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe');
        const [face, hand] = await Promise.all([
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' },
            runningMode: 'VIDEO',
            numFaces: 1,
          }),
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.5, // MediaPipe defaults; lower values let faces pass as hands
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        ]);
        this.face = face;
        this.hand = hand;
        // one pass over a blank frame compiles the GPU programs now instead of on the first camera frame
        const c = document.createElement('canvas');
        c.width = 640;
        c.height = 360;
        c.getContext('2d')!.fillRect(0, 0, c.width, c.height);
        const t = Math.max(performance.now(), this.lastTs + 1);
        this.lastTs = t;
        face.detectForVideo(c, t);
        hand.detectForVideo(c, t);
      })().catch((e) => {
        this.models = null; // let the next call retry
        throw e;
      });
    }
    return this.models;
  }

  private openCamera(): Promise<void> {
    if (!this.camera) {
      this.camera = (async () => {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
        this.video.srcObject = this.stream;
        await this.video.play();
      })().catch((e) => {
        this.camera = null;
        throw e;
      });
    }
    return this.camera;
  }

  /** Open the camera and start tracking. Concurrent calls share the same camera and models. */
  async start(opts: TrackerOptions) {
    this.opts = { ...this.opts, ...opts };
    await Promise.all([this.openCamera(), this.preload()]);
    if (!this.running) {
      this.running = true;
      this.loop();
    }
  }

  setEnabled(face: boolean, hand: boolean) {
    this.opts.face = face;
    this.opts.hand = hand;
    if (!face) this.onHead?.(null);
    if (!hand) this.onHand?.(null);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.camera = null;
  }

  // Poll on animation frames and run detection whenever the camera delivers a new frame.
  // (requestVideoFrameCallback is not reliable for a video element that isn't rendered on the page.)
  private lastVideoTime = -1;
  private lastTs = 0;
  private fpsWindow: number[] = [];
  private loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const v = this.video;
    if (v.paused && this.stream) v.play().catch(() => {}); // browsers pause media that leaves the DOM
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    const now = Math.max(performance.now(), this.lastTs + 1); // MediaPipe needs strictly increasing timestamps
    this.lastTs = now;
    this.frame++;
    this.fpsWindow.push(now);
    while (this.fpsWindow.length && now - this.fpsWindow[0] > 1000) this.fpsWindow.shift();
    this.stats.fps = this.fpsWindow.length;
    try {
      if (this.opts.face && this.face) this.processFace(this.face.detectForVideo(v, now), now);
      if (this.opts.hand && this.hand) this.processHand(this.hand.detectForVideo(v, now), now);
      this.stats.error = '';
    } catch (e) {
      this.stats.error = String(e);
      console.warn('tracking error', e);
    }
    this.stats.frames = this.frame;
    this.onStats?.(this.stats);
  };

  stats = { frames: 0, fps: 0, face: false, hand: false, error: '' };
  onStats: ((s: Tracker['stats']) => void) | null = null;

  private processFace(r: ReturnType<FaceLandmarker['detectForVideo']>, t: number) {
    const lm = r.faceLandmarks?.[0];
    this.stats.face = !!lm;
    if (!lm || lm.length < 474) {
      this.faceBox = null;
      this.onHead?.(null);
      return;
    }
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of lm) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    this.faceBox = { x0, y0, x1, y1, t };
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    const a = lm[468];
    const b = lm[473]; // iris centres
    const ipdPx = Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);
    const f = W / 2 / Math.tan(((this.opts.hfovDeg / 2) * Math.PI) / 180);
    const z = (f * this.opts.ipdMm) / Math.max(ipdPx, 1);
    const mx = ((a.x + b.x) / 2 - 0.5) * W;
    const my = ((a.y + b.y) / 2 - 0.5) * H;
    const x = (-mx * z) / f; // mirror: user moving right appears on the image's left
    const y = (-my * z) / f;
    this.onHead?.({ x: this.fx.filter(x, t), y: this.fy.filter(y, t), z: this.fz.filter(z, t) });
  }

  // False pinches: the hand model occasionally "finds" a hand in a face or a lit background for a frame or two, and
  // if that phantom's thumb and index points land close together it reads as a pinch and drops the needle somewhere.
  // Real pinches last much longer than a phantom, so a pinch only starts once the hand has been seen for a moment
  // and the fingers have been together for a few frames (~0.1 s, not noticeable). With head tracking on, a "hand"
  // sitting on the face is ignored outright.
  private handSince = -1;
  private pinchFrames = 0;
  private faceBox: { x0: number; y0: number; x1: number; y1: number; t: number } | null = null;

  private processHand(r: ReturnType<HandLandmarker['detectForVideo']>, t: number) {
    let lm: (typeof r.landmarks)[number] | undefined = r.landmarks?.[0];
    if (lm && this.faceBox && t - this.faceBox.t < 200) {
      const cx = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
      const cy = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
      const f = this.faceBox;
      if (cx > f.x0 && cx < f.x1 && cy > f.y0 && cy < f.y1) lm = undefined; // palm on the face: not a real hand
    }
    this.stats.hand = !!lm;
    if (!lm) {
      this.handSince = -1;
      this.pinchFrames = 0;
      this.pinchState = false;
      this.onHand?.(null);
      return;
    }
    if (this.handSince < 0) this.handSince = t;
    const tip = lm[8];
    const thumb = lm[4];
    const size = Math.hypot(lm[0].x - lm[5].x, lm[0].y - lm[5].y); // wrist -> index knuckle
    const pinchD = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / Math.max(size, 1e-3);
    // hysteresis so the pinch doesn't flicker; a new pinch must be held for 3 frames on a hand seen for 0.2 s
    this.pinchFrames = pinchD < 0.38 ? this.pinchFrames + 1 : 0;
    if (this.pinchState && pinchD > 0.6) this.pinchState = false;
    else if (!this.pinchState && this.pinchFrames >= 3 && t - this.handSince >= 200) this.pinchState = true;
    // Pointer = midpoint of thumb and index tips: it barely moves when the fingers close or open,
    // unlike the fingertip alone, so pinching doesn't jerk the aim.
    const px = (tip.x + thumb.x) / 2;
    const py = (tip.y + thumb.y) / 2;
    const gain = 0.95;
    const nx = Math.max(-1.2, Math.min(1.2, -(px - 0.5) * 2 * gain));
    const ny = Math.max(-1.2, Math.min(1.2, -(py - 0.5) * 2 * gain));
    this.onHand?.({ nx: this.hx.filter(nx, t), ny: this.hy.filter(ny, t), pinch: this.pinchState, depth: size });
  }
}
