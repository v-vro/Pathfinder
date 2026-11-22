import { useState } from 'react';
import type { Candidate } from '../engine/planner';
import { EVIDENCE, type Factor } from '../engine/riskModel';
import { pathEvents } from '../engine/pathEvents';
import { Meter } from './Brand';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const GRADE = { low: 'Low', moderate: 'Moderate', high: 'High', blocked: 'Blocked' } as const;

/** One light card: the headline risk in words, the three things this path does right or wrong, details on demand. */
export function RiskPanel({ cand, locked, title }: { cand: Candidate; locked: boolean; title: string }) {
  const [open, setOpen] = useState(false);
  const { analysis: a, risk: r } = cand;

  return (
    <section className={`sheet card grade-${r.grade}`} aria-live="polite">
      <header className="card-head">
        <h2>{title}</h2>
        <span className="grade">{GRADE[r.grade]}</span>
      </header>

      {!a.feasible ? (
        <ul className="blocked">
          {a.blockers.map((b, i) => (
            <li key={i}>
              {b.kind === 'length' || b.kind === 'fov' ? sentence(b.name) : `${sentence(b.name).slice(0, -1)} at ${(b.depthMm / 10).toFixed(1)} cm.`}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="headline">
            <span className="big">{pct(r.ptx)}</span>
            <span className="what">pneumothorax</span>
          </p>
          <Meter value={r.ptx} typical={EVIDENCE.ptx.baseline} />
          <div className="secondary">
            <span>Chest tube</span>
            <b>{pct(r.chestTube)}</b>
            <span>Haemorrhage</span>
            <b>{pct(r.bleed)}</b>
          </div>
          <ul className="drivers">
            {topDrivers(r.factors).map((f) => (
              <li key={f.key} className={f.tone} title={`${f.detail}${f.source ? `\n\nSource: ${f.source}` : ''}`}>
                <span className="lbl">{f.label}</span>
                <span className="val">{driverValue(f)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {locked && <Steps cand={cand} />}

      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Less' : 'Details'}
      </button>
      {open && <Details cand={cand} />}
      {locked && <p className="note">Held. Click to release.</p>}
    </section>
  );
}

/** What the needle meets on a held path, in order of depth. */
function Steps({ cand }: { cand: Candidate }) {
  const { events } = pathEvents(cand.analysis);
  return (
    <ol className="steps" aria-label="Along this path">
      {events.map((e, i) => (
        <li key={i} className={e.tone}>
          <span className="d">{(e.depthMm / 10).toFixed(1)}</span>
          <span>{e.label}</span>
        </li>
      ))}
    </ol>
  );
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + '.';

function driverValue(f: Factor) {
  if (f.noEffectSize || Math.abs(f.deltaPts) < 0.5) return f.value;
  return `${f.deltaPts > 0 ? '+' : '−'}${Math.abs(f.deltaPts).toFixed(0)} pts`;
}

/** What this *path* is doing right or wrong (patient-level factors are the same for every path: in details). */
function topDrivers(fs: Factor[]): Factor[] {
  const path = fs.filter((f) => !f.patientLevel);
  const flagged = path.filter((f) => f.noEffectSize && f.key !== 'angle' && (f.tone === 'bad' || f.tone === 'warn'));
  const ranked = path.filter((f) => !f.noEffectSize && f.deltaPts >= 1).sort((a, b) => b.deltaPts - a.deltaPts);
  const good = path.filter((f) => f.tone === 'good' && f.key !== 'angle');
  return [...flagged, ...ranked, ...good].filter((f, i, arr) => arr.indexOf(f) === i).slice(0, 3);
}

function Details({ cand }: { cand: Candidate }) {
  const { analysis: a, risk: r } = cand;
  const row = (f: Factor) => (
    <tr key={f.key} className={f.tone} title={`${f.detail}${f.source ? `\n\nSource: ${f.source}` : ''}`}>
      <th scope="row">
        {f.label}
        {f.patientLevel && <small> (patient)</small>}
      </th>
      <td>{f.value}</td>
      <td className="num">{f.noEffectSize ? '' : `${f.deltaPts >= 0 ? '+' : '−'}${Math.abs(f.deltaPts).toFixed(0)}`}</td>
    </tr>
  );
  return (
    <div className="details">
      <table>
        <caption>Pneumothorax, typical {pct(EVIDENCE.ptx.baseline)}</caption>
        <tbody>{r.factors.filter((f) => f.outcome === 'ptx').map(row)}</tbody>
      </table>
      <table>
        <caption>Haemorrhage, typical {pct(EVIDENCE.bleed.baseline)}</caption>
        <tbody>{r.factors.filter((f) => f.outcome === 'bleed').map(row)}</tbody>
      </table>
      <table>
        <caption>Path</caption>
        <tbody>
          <tr>
            <th scope="row">Skin to pleura</th>
            <td colSpan={2}>{a.chestWallMm !== null ? `${(a.chestWallMm / 10).toFixed(1)} cm` : 'n/a'}</td>
          </tr>
          <tr>
            <th scope="row">Skin to nodule</th>
            <td colSpan={2}>{a.lesionDepthMm !== null ? `${(a.lesionDepthMm / 10).toFixed(1)} cm` : 'n/a'}</td>
          </tr>
          <tr>
            <th scope="row">Tilt</th>
            <td colSpan={2}>{a.tiltDeg.toFixed(0)}°</td>
          </tr>
        </tbody>
      </table>
      {r.warnings.length > 0 && (
        <ul className="warnings">
          {r.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <p className="fine">Points: added risk vs. best case. From published odds ratios; for comparing paths.</p>
    </div>
  );
}
