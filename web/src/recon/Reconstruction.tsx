// The reconstruction, shown step by step so a clinician (or a judge) can check each structure against the CT.
// Left: the 3D model built so far, labelled. Right: the CT with the same structures outlined in the same colours.
// Hover a label, a 3D part or a CT pixel and the matching structure lights up on both sides.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaseData } from '../engine/loadCase';
import type { Vec3 } from '../engine/types';
import { CtPanel, codeAt, type Plane } from './CtPanel';
import { ReconViewer } from './ReconViewer';
import { ROMAN, STEPS, type LegendItem } from './steps';
import { Mark } from '../ui/Brand';

export function Reconstruction({ data, onDone, onBack }: { data: CaseData; onDone: () => void; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<ReconViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [idx, setIdx] = useState(0);
  const [confirmed, setConfirmed] = useState<boolean[]>(STEPS.map(() => false));
  const step = STEPS[idx];
  const [plane, setPlane] = useState<Plane>(step.plane);
  const [point, setPoint] = useState<Vec3>(data.meta.target.center);
  const [hl, setHl] = useState<LegendItem | null>(null);
  const [hover, setHover] = useState<{ name: string } | null>(null);
  const [showPlane, setShowPlane] = useState(true);

  // boot the 3D view
  useEffect(() => {
    const v = new ReconViewer(canvasRef.current!);
    viewer.current = v;
    v.load(data.base + data.meta.files.anatomy).then(() => setReady(true));
    return () => v.dispose();
  }, [data]);

  // new step: default plane / position, show its parts
  useEffect(() => {
    setPlane(step.plane);
    const t = data.meta.target.center;
    const g = data.meta.ctGrid;
    const mid: Vec3 = [g.origin[0] + (g.dims[0] * g.spacing) / 2, g.origin[1] + (g.dims[1] * g.spacing) / 2, g.origin[2] + (g.dims[2] * g.spacing) / 2];
    setPoint(step.at === 'nodule' ? t : step.at === 'spine' ? [data.meta.landmarks.midlineX, (data.meta.landmarks.spinePosteriorY ?? mid[1]) - 25, t[2]] : [mid[0], mid[1], t[2] - 60]);
    setHl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  useEffect(() => {
    if (!ready || !viewer.current) return;
    const cur = step.legend.flatMap((l) => l.meshes);
    const ctx = STEPS.slice(0, idx).flatMap((s) => s.legend.flatMap((l) => l.meshes)).filter((m) => !cur.includes(m) && m !== 'skin');
    viewer.current.show(cur, ctx);
  }, [ready, idx, step]);

  useEffect(() => {
    viewer.current?.highlight(hl && hl.meshes.length ? hl.meshes[0] : null);
  }, [hl]);

  useEffect(() => viewer.current?.setPlaneVisible(showPlane), [showPlane]);

  const legendFor = (code: number) => step.legend.find((l) => l.code === code) ?? null;
  const total = STEPS.length;
  const allDone = confirmed.every(Boolean);
  const stats = useMemo(() => step.stats(data.meta), [step, data]);

  const confirm = () => {
    const c = [...confirmed];
    c[idx] = true;
    setConfirmed(c);
    if (idx < total - 1) setIdx(idx + 1);
  };

  return (
    <div className="page recon">
      <nav className="rail" aria-label="Reconstruction steps">
        <div className="wordmark">
          <Mark size={24} />
          <span className="name">Pathfinder</span>
        </div>
        <button className="link light back" onClick={onBack}>
          Back to scan
        </button>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button className={`${i === idx ? 'on' : ''} ${confirmed[i] ? 'done' : ''}`} onClick={() => setIdx(i)}>
                <span className="mark" aria-hidden>
                  {ROMAN[i]}
                </span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        <button className="primary wide" disabled={!allDone} onClick={onDone}>
          {allDone ? 'Open planner' : `${confirmed.filter(Boolean).length} / ${total} confirmed`}
        </button>
        <button className="link light skip" onClick={onDone}>
          Skip
        </button>
      </nav>

      <section className="model">
        <canvas ref={canvasRef} className="recon-canvas" />
        {!ready && <p className="model-loading">Loading model</p>}
        <ul className="legend-list">
          {step.legend.map((l) => (
            <li key={l.name}>
              <button
                className={hl === l ? 'on' : ''}
                onMouseEnter={() => setHl(l)}
                onMouseLeave={() => setHl(null)}
                onFocus={() => setHl(l)}
                onBlur={() => setHl(null)}
              >
                <i style={{ background: l.color }} />
                {l.name}
              </button>
            </li>
          ))}
        </ul>
        <label className="plane-toggle">
          <input type="checkbox" checked={showPlane} onChange={() => setShowPlane(!showPlane)} /> Slice in model
        </label>
      </section>

      <section className="evidence">
        <header>
          <p className="count">
            {ROMAN[idx]} of {ROMAN[total - 1]}
          </p>
          <h2>{step.title}</h2>
        </header>

        <div className="ct-block">
          <div className="ct-tabs segmented dark">
            {(['axial', 'coronal', 'sagittal'] as Plane[]).map((p) => (
              <button key={p} className={plane === p ? 'on' : ''} onClick={() => setPlane(p)}>
                {p === 'axial' ? 'Axial' : p === 'coronal' ? 'Coronal' : 'Sagittal'}
              </button>
            ))}
          </div>
          <div className="ct-wrap">
            <CtPanel
              data={data}
              plane={plane}
              point={point}
              overlay={step.overlay}
              highlight={hl?.code ?? null}
              win={step.win}
              crosshair={false}
              onCanvas={(c) => viewer.current?.setSlice(c, plane, point, data.meta.ctGrid)}
              onPick={(p) => setPoint(p)}
              onHover={(p, code) => {
                viewer.current?.setMarker(p);
                const l = p ? legendFor(code) : null;
                setHl(l);
                setHover(p ? { name: l?.name ?? describe(data, p) } : null);
              }}
            />
            {hover && <span className="ct-tip">{hover.name}</span>}
          </div>
          <input
            className="scrub"
            type="range"
            {...sliderFor(data, plane)}
            value={plane === 'axial' ? point[2] : plane === 'coronal' ? point[1] : point[0]}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPoint(plane === 'axial' ? [point[0], point[1], v] : plane === 'coronal' ? [point[0], v, point[2]] : [v, point[1], point[2]]);
            }}
            aria-label="Move through the slices"
          />
        </div>

        <dl className="explain">
          <dt>Method</dt>
          <dd>{step.how}</dd>
          <dt>Reliability</dt>
          <dd>{step.accuracy}</dd>
          <dt>Check</dt>
          <dd>{step.check}</dd>
        </dl>
        <div>
          <dl className="stats">
            {stats.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <footer className="step-actions">
          {idx > 0 && (
            <button className="quiet" onClick={() => setIdx(idx - 1)}>
              Back
            </button>
          )}
          <button className="primary" onClick={confirm}>
            {confirmed[idx] ? 'Confirmed' : 'Confirm'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function sliderFor(d: CaseData, plane: Plane) {
  const g = d.meta.ctGrid;
  const axis = plane === 'axial' ? 2 : plane === 'coronal' ? 1 : 0;
  return { min: g.origin[axis], max: g.origin[axis] + (g.dims[axis] - 1) * g.spacing, step: 1 };
}

function describe(d: CaseData, p: Vec3): string {
  const lab = codeAt(d, 'labels', p[0], p[1], p[2]);
  return d.meta.labels[String(lab)] ?? '';
}
