// The scan: upload placeholder + the three standard views of the same CT volume, linked by a crosshair.
import { useState } from 'react';
import type { CaseData } from '../engine/loadCase';
import type { Vec3 } from '../engine/types';
import { Mark } from '../ui/Brand';
import { CtPanel } from './CtPanel';

export function Intake({ data, onContinue }: { data: CaseData; onContinue: () => void }) {
  const [p, setP] = useState<Vec3>(data.meta.target.center);
  const [win, setWin] = useState<'lung' | 'soft'>('lung');
  const [dropped, setDropped] = useState(false);
  const s = data.meta.scan ?? {};
  const sp = (s.spacingMm as number[] | undefined) ?? [];
  const size = (s.size as number[] | undefined) ?? [];

  return (
    <div className="page intake">
      <section className="intro">
        <a className="wordmark" href="/" title="Back to the home page">
          <Mark size={30} />
          <span className="name">Pathfinder</span>
        </a>
        <h1>The scan</h1>
        <p className="lede">One CT volume. Every view is cut from the same stack.</p>

        <label
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setDropped(true);
          }}
        >
          <input type="file" multiple onChange={() => setDropped(true)} />
          <strong>{dropped ? 'Received' : 'Drop DICOM or NIfTI'}</strong>
          <span>{dropped ? 'Uploads aren’t processed in this demo. Continue with the sample scan.' : 'or choose files'}</span>
        </label>

        <dl className="scan-facts">
          <dt>Source</dt>
          <dd>LIDC-IDRI, chest CT</dd>
          <dt>Scanner</dt>
          <dd>{s.manufacturerModelName ?? 'Unknown'}</dd>
          <dt>Slices</dt>
          <dd>
            {size[2]} at {sp[2]} mm
          </dd>
          <dt>Pixels</dt>
          <dd>
            {size[0]} × {size[1]} at {sp[0]} mm
          </dd>
          <dt>Field</dt>
          <dd>{s.reconstructionDiameter ? `${Number(s.reconstructionDiameter).toFixed(0)} mm` : 'Unknown'}</dd>
        </dl>

        <button className="primary" onClick={onContinue}>
          Reconstruct
        </button>
      </section>

      <section className="views">
        <div className="views-head">
          <div className="segmented dark">
            <button className={win === 'lung' ? 'on' : ''} onClick={() => setWin('lung')}>
              Lung
            </button>
            <button className={win === 'soft' ? 'on' : ''} onClick={() => setWin('soft')}>
              Soft tissue
            </button>
          </div>
        </div>
        <div className="three">
          <figure className="view big">
            <CtPanel data={data} plane="axial" point={p} win={win} onPick={setP} />
            <figcaption>
              Axial <span className="mono">z {p[2].toFixed(0)}</span>
            </figcaption>
          </figure>
          <figure className="view">
            <CtPanel data={data} plane="coronal" point={p} win={win} onPick={setP} />
            <figcaption>
              Coronal <span className="mono">y {p[1].toFixed(0)}</span>
            </figcaption>
          </figure>
          <figure className="view">
            <CtPanel data={data} plane="sagittal" point={p} win={win} onPick={setP} />
            <figcaption>
              Sagittal <span className="mono">x {p[0].toFixed(0)}</span>
            </figcaption>
          </figure>
        </div>
        <input
          className="scrub"
          type="range"
          min={data.meta.ctGrid.origin[2]}
          max={data.meta.ctGrid.origin[2] + (data.meta.ctGrid.dims[2] - 1) * data.meta.ctGrid.spacing}
          step={1}
          value={p[2]}
          onChange={(e) => setP([p[0], p[1], Number(e.target.value)])}
          aria-label="Axial slice"
        />
      </section>
    </div>
  );
}
