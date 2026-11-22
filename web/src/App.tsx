import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import './pages.css';
import { loadCase, type CaseData } from './engine/loadCase';
import { entryFromDirection } from './engine/pathAnalysis';
import { buildPlan, type PlanJSON } from './engine/plan';
import { autoPlan, computeSkinMap, evaluate, type Candidate, type SkinMap } from './engine/planner';
import { L, type Vec3 } from './engine/types';
import { dot as dot3, norm, scale, sub } from './engine/vec';
import { Viewer, type LayerName, type MarkerKind } from './scene/Viewer';
import { Tracker, type HandPointer, type HeadPose } from './tracking/tracker';
import { DoctorDrawer, PatientDrawer } from './ui/Drawers';
import { PanelBoundary } from './ui/PanelBoundary';
import { RiskPanel } from './ui/RiskPanel';
import { SliceView, type CtWindow, type SliceMode } from './ui/SliceView';
import { DitherLoader, Mark } from './ui/Brand';
import { Intake } from './recon/Intake';
import { Reconstruction } from './recon/Reconstruction';

const CASE_ID = new URLSearchParams(location.search).get('case') ?? 'lidc-0742';
const GRADE_COLOR = { low: '#f2f2f2', moderate: '#bdbdbd', high: '#ffffff', blocked: '#7a7a7a' } as const;
const FISSURE_MESH: Record<string, string> = {
  'right major (oblique) fissure': 'right_oblique_fissure',
  'right minor (horizontal) fissure': 'right_horizontal_fissure',
  'left major (oblique) fissure': 'left_oblique_fissure',
};

const LAYERS: { key: LayerName; label: string; def: boolean }[] = [
  { key: 'bones', label: 'Bones', def: true },
  { key: 'lungs', label: 'Lungs', def: true },
  { key: 'vessels', label: 'Vessels', def: true },
  { key: 'heart', label: 'Heart', def: true },
  { key: 'fissures', label: 'Fissures', def: true },
  { key: 'airways', label: 'Airways', def: false },
  { key: 'safezones', label: 'Entry map', def: false },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camBox = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const neutral = useRef<{ x: number; y: number; z: number; n: number } | null>(null);
  const flipRef = useRef(false);
  const [data, setData] = useState<CaseData | null>(null);
  const [stage, setStage] = useState<'intake' | 'recon' | 'plan'>(() => (new URLSearchParams(location.search).has('plan') ? 'plan' : 'intake'));
  const [status, setStatus] = useState('Loading scan');
  const [cand, setCand] = useState<Candidate | null>(null);
  const [outer, setOuter] = useState<Vec3 | null>(null);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const debugState = useRef<{ entry: Vec3 | null; locked: boolean }>({ entry: null, locked: false });
  const [map, setMap] = useState<SkinMap | null>(null);
  const [plans, setPlans] = useState<Candidate[]>([]);
  const [planning, setPlanning] = useState(false);
  const [visible, setVisible] = useState<Record<LayerName, boolean>>(
    Object.fromEntries(LAYERS.map((l) => [l.key, l.def])) as Record<LayerName, boolean>,
  );
  const [sliceMode, setSliceMode] = useState<SliceMode>('needle');
  const [win] = useState<CtWindow>('lung');
  const [headOn, setHeadOn] = useState(false);
  const [handOn, setHandOn] = useState(false);
  const [trackMsg, setTrackMsg] = useState('');
  const [tstats, setTstats] = useState<Tracker['stats'] | null>(null);
  const [hand, setHand] = useState<HandPointer | null>(null);
  const [drawer, setDrawer] = useState<'doctor' | 'patient' | null>(null);
  const [menu, setMenu] = useState(false);
  const [framing, setFraming] = useState<'chest' | 'body'>('chest');
  const [flip, setFlip] = useState(() => storageGet('pf.flip') === '1');
  const [screenMm, setScreenMm] = useState(() => Number(storageGet('pf.screenMm') ?? 301));

  const target: Vec3 | null = data ? data.meta.target.center : null;
  debugState.current = { entry: cand?.entry ?? null, locked };
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    flipRef.current = flip;
  }, [flip]);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    const v = new Viewer(canvasRef.current!);
    viewerRef.current = v;
    v.setScreen({ widthMm: screenMm });
    (window as unknown as { __pf: unknown }).__pf = { viewer: v, tracker: () => trackerRef.current, state: () => debugState.current };
    let cancelled = false;
    (async () => {
      try {
        const d = await loadCase(CASE_ID, () => setStatus('Loading scan'));
        if (cancelled) return;
        setStatus('Building model');
        await v.loadAnatomy(d.base + d.meta.files.anatomy, d.meta.body);
        v.setCenterlines(d.lines);
        setData(d);
        setStatus('Mapping entry points');
        setTimeout(() => {
          const verts = v.skinVertices();
          if (verts) {
            const m = computeSkinMap(d, verts, v.skinNormals(), d.meta.target.center);
            v.setSkinRisk(m.colors);
            setMap(m);
          }
          setStatus('');
        }, 50);
      } catch (e) {
        console.error(e);
        setStatus(`Scan "${CASE_ID}" not found. Run the pipeline, then reload.`);
      }
    })();
    return () => {
      cancelled = true;
      v.dispose();
      trackerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.paused = stage !== 'plan';
  }, [stage]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !data) return;
    for (const l of LAYERS) v.setLayer(l.key, { visible: visible[l.key], opacity: 1 });
  }, [visible, data]);

  // ---------------------------------------------------------------- needle + alerts
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (!cand) {
      v.setNeedle(null);
      v.setAlerts({ fissures: [], organs: [] });
      return;
    }
    const a = cand.analysis;
    const markers: { p: Vec3; kind: MarkerKind }[] = [];
    if (a.pleuraPoint) markers.push({ p: a.pleuraPoint, kind: 'pleura' });
    for (const b of a.blockers) if (b.kind !== 'length') markers.push({ p: b.at, kind: 'blocker' });
    v.setNeedle({ entry: cand.entry, target: a.target, color: GRADE_COLOR[cand.risk.grade], markers, outer: locked ? null : outer });
    v.setAlerts({
      fissures: a.fissures.map((f) => FISSURE_MESH[f.name]).filter(Boolean),
      organs: a.blockers
        .filter((b) => b.kind === 'organ')
        .map((b) => (b.label === L.HEART ? 'heart' : b.label === L.GREAT_VESSEL ? 'great_vessels' : ''))
        .filter(Boolean),
    });
  }, [cand, outer, locked]);

  // ---------------------------------------------------------------- aiming (the needle always points at the nodule)
  /** Candidate path for a needle pointing from p toward the nodule (null if there's no skin entry). */
  const candidateToward = useCallback(
    (p: Vec3 | null): Candidate | null => {
      if (!data || !p) return null;
      const tgt = data.meta.target.center;
      const entry = entryFromDirection(data, tgt, norm(sub(p, tgt)));
      return entry ? evaluate(data, entry, tgt) : null;
    },
    [data],
  );
  const aimToward = useCallback(
    (p: Vec3 | null, outerPt: Vec3 | null = null) => {
      if (lockedRef.current) return;
      const c = candidateToward(p);
      if (!c) return;
      setCand(c);
      setOuter(outerPt);
    },
    [candidateToward],
  );

  const raf = useRef(0);
  const onPointerMove = (e: React.PointerEvent) => {
    if (!data || handOn || e.buttons & 2 || e.shiftKey) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => aimToward(viewerRef.current!.pickSkin(clientX, clientY)));
  };
  const downAt = useRef({ x: 0, y: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    downAt.current = { x: e.clientX, y: e.clientY };
    setMenu(false);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.shiftKey) return;
    if (Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 6) return;
    if (locked) setLocked(false);
    else if (cand) setLocked(true);
  };

  // Hand: pinch to aim, release to hold. While pinched the needle follows the pinch point; on release it
  // holds the aim from just before the fingers started to open (release motion would otherwise jerk it).
  const pinchPrev = useRef(false);
  const aimHistory = useRef<{ t: number; c: Candidate }[]>([]);
  const lastAimDir = useRef<Vec3 | null>(null);
  const holdFromHistory = () => {
    const h = aimHistory.current;
    if (!h.length) return;
    const cutoff = performance.now() - 150;
    const pick = [...h].reverse().find((e) => e.t <= cutoff) ?? h[0];
    setCand(pick.c);
    setOuter(null);
    setLocked(true);
    lockedRef.current = true;
    aimHistory.current = [];
  };
  useEffect(() => {
    if (!data || !viewerRef.current) return;
    if (!hand) {
      if (pinchPrev.current) holdFromHistory(); // lost the hand mid-pinch: hold the last good aim
      pinchPrev.current = false;
      return;
    }
    const startedPinch = hand.pinch && !pinchPrev.current;
    const released = !hand.pinch && pinchPrev.current;
    pinchPrev.current = hand.pinch;
    if (released) return holdFromHistory();
    if (!hand.pinch) return;
    if (startedPinch) {
      setLocked(false);
      lockedRef.current = false;
      aimHistory.current = [];
      lastAimDir.current = null;
    }
    const glass = viewerRef.current.glassToLPS(hand.nx, hand.ny, 0);
    const tgt = data.meta.target.center;
    const dir = norm(sub(glass, tgt));
    // ignore hand wobble under 1° so the needle sits still and the risk numbers don't flicker
    if (lastAimDir.current && dot3(dir, lastAimDir.current) > Math.cos((1 * Math.PI) / 180)) return;
    lastAimDir.current = dir;
    const c = candidateToward(glass);
    if (!c) return;
    setCand(c);
    setOuter(glass);
    const now = performance.now();
    aimHistory.current.push({ t: now, c });
    while (aimHistory.current.length && now - aimHistory.current[0].t > 600) aimHistory.current.shift();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand, data, candidateToward]);

  // ---------------------------------------------------------------- tracking
  const onHead = (p: HeadPose | null) => {
    const v = viewerRef.current;
    if (!p || !v) return;
    // the first second of tracking defines "neutral"; movement is measured from there
    const n = neutral.current;
    if (!n || n.n < 20) {
      const k = n ? n.n : 0;
      neutral.current = n
        ? { x: (n.x * k + p.x) / (k + 1), y: (n.y * k + p.y) / (k + 1), z: (n.z * k + p.z) / (k + 1), n: k + 1 }
        : { ...p, n: 1 };
      return;
    }
    const s = flipRef.current ? -1 : 1;
    v.setHeadOffset(s * (p.x - n.x), p.y - n.y, p.z - n.z);
  };
  const recenter = () => {
    neutral.current = null;
    viewerRef.current?.clearHead();
  };

  const ensureTracker = async (face: boolean, handTrack: boolean) => {
    if (!face) {
      recenter();
    }
    if (!face && !handTrack) {
      trackerRef.current?.setEnabled(false, false);
      return;
    }
    try {
      setTrackMsg('Starting camera');
      if (!trackerRef.current) {
        const t = new Tracker();
        t.onHead = (p) => onHead(p);
        t.onHand = (h) => setHand(h);
        let last = 0;
        t.onStats = (s) => {
          const now = performance.now();
          if (now - last > 250) {
            last = now;
            setTstats({ ...s });
          }
        };
        trackerRef.current = t;
      }
      await trackerRef.current.start({ face, hand: handTrack });
      trackerRef.current.setEnabled(face, handTrack);
      if (camBox.current && !camBox.current.contains(trackerRef.current.video)) camBox.current.appendChild(trackerRef.current.video);
      setTrackMsg('');
    } catch (e) {
      setTrackMsg(`Camera unavailable: ${e}`);
      setHeadOn(false);
      setHandOn(false);
    }
  };
  const toggleHead = () => {
    const n = !headOn;
    setHeadOn(n);
    recenter();
    ensureTracker(n, handOn);
  };
  const toggleHand = () => {
    const n = !handOn;
    setHandOn(n);
    if (!n) setHand(null);
    ensureTracker(headOn, n);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const v = viewerRef.current;
      if (!v) return;
      if (!headOn) {
        // no webcam: arrow keys move a virtual head (same amplification as real tracking)
        const h = (v as unknown as { _kh?: number[] })._kh ?? [0, 0, 0];
        if (e.key === 'ArrowLeft') h[0] -= 30;
        if (e.key === 'ArrowRight') h[0] += 30;
        if (e.key === 'ArrowUp') h[1] += 30;
        if (e.key === 'ArrowDown') h[1] -= 30;
        if (e.key === '-') h[2] += 40;
        if (e.key === '=') h[2] -= 40;
        if (e.key === '0') h.splice(0, 3, 0, 0, 0);
        (v as unknown as { _kh?: number[] })._kh = h;
        if (e.key.startsWith('Arrow') || e.key === '-' || e.key === '=' || e.key === '0') v.setHeadOffset(h[0], h[1], h[2]);
      }
      if (e.key === 'c') recenter();
      if (e.key === 'l') setLocked((l) => !l);
      if (e.key === 'f') document.documentElement.requestFullscreen?.();
      if (e.key === 'b') toggleFraming();
      if (e.key === '1') v.face('anterior');
      if (e.key === '2') v.face('posterior');
      if (e.key === '3') v.face('right');
      if (e.key === '4') v.face('left');
      if (e.key === 'Escape') {
        setMenu(false);
        setDrawer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headOn]);

  const toggleFraming = () => {
    const v = viewerRef.current;
    if (!v) return;
    const next = v.framing === 'chest' ? 'body' : 'chest';
    v.setFraming(next);
    setFraming(next);
  };

  // ---------------------------------------------------------------- auto plan
  const choose = (c: Candidate) => {
    setCand(c);
    setOuter(null);
    setLocked(true);
    viewerRef.current?.faceDirection(scale(c.analysis.dir, -1));
  };
  const runAutoPlan = () => {
    if (!data || !map || !viewerRef.current) return;
    setPlanning(true);
    setTimeout(() => {
      const res = autoPlan(data, viewerRef.current!.skinVertices()!, map, data.meta.target.center);
      setPlans(res);
      if (res[0]) choose(res[0]);
      setPlanning(false);
    }, 30);
  };

  const plan: PlanJSON | null = useMemo(() => {
    if (!data || !cand || !cand.analysis.feasible) return null;
    const isBest = plans.length && plans[0] === cand;
    return buildPlan(data, cand, map?.stats ?? null, isBest ? plans : []);
  }, [data, cand, map, plans]);

  const cardTitle = !locked ? 'Aiming' : plans[0] === cand ? 'Safest path' : plans.includes(cand!) ? `Option ${plans.indexOf(cand!) + 1}` : 'Held path';
  const handPx = hand ? { left: ((hand.nx + 1) / 2) * window.innerWidth, top: ((1 - hand.ny) / 2) * window.innerHeight } : null;
  const camLine = !tstats
    ? trackMsg
    : [headOn ? (tstats.face ? 'head ok' : 'no face') : '', handOn ? (tstats.hand ? (hand?.pinch ? 'pinch' : 'hand ok') : 'no hand') : '', `${tstats.fps} fps`]
        .filter(Boolean)
        .join('  ');

  return (
    <div className="app">
      <canvas ref={canvasRef} className="stage" onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp} />

      <header className="topbar">
        <div className="wordmark">
          <Mark />
          <div>
            <span className="name">Pathfinder</span>
            {data && (
              <span className="case" title={data.meta.source}>
                {data.meta.target.diameterMm.toFixed(0)} mm nodule, {data.meta.target.lobe}
              </span>
            )}
          </div>
        </div>
        <nav className="modes">
          <button className="mode" onClick={() => setStage('recon')}>
            Model
          </button>
          <button className={`mode ${headOn ? 'on' : ''}`} onClick={toggleHead} aria-pressed={headOn}>
            Head
          </button>
          <button className={`mode ${handOn ? 'on' : ''}`} onClick={toggleHand} aria-pressed={handOn}>
            Hand
          </button>
          <button className={`mode ${menu ? 'on' : ''}`} onClick={() => setMenu(!menu)} aria-expanded={menu}>
            View
          </button>
        </nav>
      </header>

      {menu && data && (
        <div className="sheet menu" role="dialog" aria-label="View options">
          <div className="menu-group">
            <h3>Show</h3>
            {LAYERS.filter((l) => viewerRef.current?.hasLayer(l.key)).map((l) => (
              <label key={l.key} className="check">
                <input type="checkbox" checked={visible[l.key]} onChange={() => setVisible({ ...visible, [l.key]: !visible[l.key] })} />
                {l.label}
              </label>
            ))}
          </div>
          <div className="menu-group">
            <h3>Frame</h3>
            <div className="segmented">
              <button className={framing === 'chest' ? 'on' : ''} onClick={() => framing !== 'chest' && toggleFraming()}>
                Chest
              </button>
              <button className={framing === 'body' ? 'on' : ''} onClick={() => framing !== 'body' && toggleFraming()}>
                Body
              </button>
            </div>
            <div className="turns">
              <button onClick={() => viewerRef.current?.face('anterior')}>Front</button>
              <button onClick={() => viewerRef.current?.face('posterior')}>Back</button>
              <button onClick={() => viewerRef.current?.face('right')}>Right</button>
              <button onClick={() => viewerRef.current?.face('left')}>Left</button>
            </div>
          </div>
          <div className="menu-group">
            <h3>Tracking</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={flip}
                onChange={() => {
                  setFlip(!flip);
                  storageSet('pf.flip', !flip ? '1' : '0');
                }}
              />
              Mirror left/right
            </label>
            <button className="link" onClick={recenter}>
              Re-centre (C)
            </button>
            <label className="field">
              Screen width, mm
              <input
                type="number"
                value={screenMm}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setScreenMm(n);
                  storageSet('pf.screenMm', String(n));
                  viewerRef.current?.setScreen({ widthMm: n });
                }}
              />
            </label>
          </div>
        </div>
      )}

      {cand && (
        <aside className="left">
          <RiskPanel cand={cand} locked={locked} title={cardTitle} />
        </aside>
      )}

      {data && target && cand && (
        <aside className="right">
          <figure className="film">
            <SliceView data={data} path={cand.analysis} target={target} mode={sliceMode} win={win} overlay size={248} />
            <figcaption>
              <span>{sliceMode === 'needle' ? 'Along needle' : 'Axial'}</span>
              <button className="link light" onClick={() => setSliceMode(sliceMode === 'needle' ? 'axial' : 'needle')}>
                {sliceMode === 'needle' ? 'Axial' : 'Along needle'}
              </button>
            </figcaption>
          </figure>
        </aside>
      )}

      <footer className="dock">
        {data && !status && (handOn ? !hand?.pinch && !locked : !cand) && <p className="hint">{handOn ? "Pinch to aim. Release to hold." : "Hover to aim. Click to hold."}</p>}
        <div className="actions">
          <button className="primary" onClick={runAutoPlan} disabled={!map || planning}>
            {planning ? 'Searching…' : 'Find safest path'}
          </button>
          {plans.length > 1 &&
            plans.map((p, i) => (
              <button key={i} className={`alt ${cand === p ? 'on' : ''}`} onClick={() => choose(p)} title={`Pneumothorax ${(p.risk.ptx * 100).toFixed(0)}%`}>
                {i === 0 ? 'Best' : `Option ${i + 1}`}
              </button>
            ))}
          {plan && (
            <>
              <span className="sep" aria-hidden />
              <button className="quiet" onClick={() => setDrawer('doctor')}>
                Plan
              </button>
              <button className="quiet" onClick={() => setDrawer('patient')}>
                For patient
              </button>
            </>
          )}
        </div>
      </footer>

      <div className={`cam ${headOn || handOn ? 'show' : ''}`}>
        {/* React must never manage this node's children: removing the <video> from the DOM pauses it */}
        <div className="cam-video" ref={camBox} />
        {camLine && <div className="cam-msg">{camLine}</div>}
      </div>

      {handPx && <div className={`hand-cursor ${hand?.pinch ? 'pinch' : ''} ${locked ? 'locked' : ''}`} style={handPx} />}

      {drawer === 'doctor' && plan && (
        <PanelBoundary onClose={() => setDrawer(null)}>
          <DoctorDrawer plan={plan} onClose={() => setDrawer(null)} />
        </PanelBoundary>
      )}
      {drawer === 'patient' && plan && (
        <PanelBoundary onClose={() => setDrawer(null)}>
          <PatientDrawer plan={plan} snapshot={() => viewerRef.current!.snapshot()} onClose={() => setDrawer(null)} />
        </PanelBoundary>
      )}

      {status && (
        <div className="loading">
          <DitherLoader />
          <div className="wordmark">
            <Mark size={30} />
            <span className="name">Pathfinder</span>
          </div>
          <p>{status}</p>
        </div>
      )}
      <p className="disclaimer">Planning aid only.</p>
      {data && !status && stage === 'intake' && <Intake data={data} onContinue={() => setStage('recon')} />}
      {data && !status && stage === 'recon' && <Reconstruction data={data} onBack={() => setStage('intake')} onDone={() => setStage('plan')} />}
    </div>
  );
}

function storageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function storageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
