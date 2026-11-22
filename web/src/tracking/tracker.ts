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

  async start(opts: TrackerOptions) {
    this.opts = { ...this.opts, ...opts };
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
    }
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe');
    if (this.opts.face && !this.face) {
      this.face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
    }
    if (this.opts.hand && !this.hand) {
      this.hand = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.35,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
    }
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
      this.onHead?.(null);
      return;
    }
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

  private processHand(r: ReturnType<HandLandmarker['detectForVideo']>, t: number) {
    const lm = r.landmarks?.[0];
    this.stats.hand = !!lm;
    if (!lm) {
      this.onHand?.(null);
      return;
    }
    const tip = lm[8];
    const thumb = lm[4];
    const size = Math.hypot(lm[0].x - lm[5].x, lm[0].y - lm[5].y); // wrist -> index knuckle
    const pinchD = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / Math.max(size, 1e-3);
    // hysteresis so the pinch doesn't flicker
    if (this.pinchState && pinchD > 0.6) this.pinchState = false;
    else if (!this.pinchState && pinchD < 0.38) this.pinchState = true;
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
