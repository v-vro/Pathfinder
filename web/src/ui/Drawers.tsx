import { useEffect, useRef, useState } from 'react';
import type { PlanJSON } from '../engine/plan';
import { getHealth, post } from './api';
import { mdToHtml } from './md';
import { CHAT_BUSY, doctorTemplate, patientTemplate, sourceLabel } from './offline';

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function DoctorDrawer({ plan, onClose }: { plan: PlanJSON; onClose: () => void }) {
  const [md, setMd] = useState<string | null>(null);
  const [src, setSrc] = useState('');
  const g = plan.geometry;
  useEffect(() => {
    let live = true;
    setMd(null);
    setSrc('');
    post<{ markdown: string; source: string }>('/api/doctor-plan', { plan })
      .then((r) => {
        if (!live) return;
        setMd(r.markdown);
        setSrc(r.source);
      })
      .catch(() => {
        if (!live) return;
        setMd(doctorTemplate(plan));
        setSrc('template');
      });
    return () => {
      live = false;
    };
  }, [plan]);

  return (
    <div className="drawer">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">Procedure plan</div>
          <h2>{plan.target.description}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="drawer-body">
        <div className="plan-grid">
          <PlanCell k="Position" v={g.positionText} />
          <PlanCell k="Entry" v={g.entryText} />
          <PlanCell k="Angle" v={g.angleText} />
          <PlanCell k="Tilt" v={g.tiltText} />
          <PlanCell
            k="Depth"
            v={`Skin→pleura ${fmtCm(plan.measurements.chestWallMm)} · lung ${fmtCm(plan.measurements.aeratedLungMm)} · lesion edge ${fmtCm(plan.measurements.lesionDepthMm)} · centre ${fmtCm(plan.measurements.totalMm)}`}
          />
          <PlanCell k="Needle" v={g.needleText} />
          <PlanCell k="Table position" v={`Entry at z = ${g.tableZmm.toFixed(0)} mm; target slice z = ${g.targetZmm.toFixed(0)} mm`} />
          <PlanCell
            k="Estimated risk"
            v={`Pneumothorax ${pct(plan.risk.pneumothorax)} · chest tube ${pct(plan.risk.chestTube)} · bleeding ${pct(plan.risk.haemorrhage)}`}
          />
        </div>
        <div className="two-col">
          <div>
            <div className="section-label">Avoids</div>
            <ul className="tick-list">
              {plan.avoids.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="section-label">Unavoidable</div>
            <ul className="tick-list warn">
              {plan.cannotAvoid.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="section-label">
          Narrative {src && <span className="src">{sourceLabel(src)}</span>}
        </div>
        {md === null && <div className="skeleton">Writing…</div>}
        {md && <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(md) }} />}
      </div>
    </div>
  );
}

function PlanCell({ k, v }: { k: string; v: string }) {
  return (
    <div className="plan-cell">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

const fmtCm = (mm: number | null) => (mm === null ? '—' : `${(mm / 10).toFixed(1)} cm`);

export const LANGUAGES = [
  'English',
  'Français',
  'Español',
  '中文 (Mandarin)',
  '廣東話 (Cantonese)',
  'ਪੰਜਾਬੀ (Punjabi)',
  'العربية (Arabic)',
  'हिन्दी (Hindi)',
  'Tagalog',
  'Português',
  'Italiano',
  'Tiếng Việt',
  'Українська',
  'فارسی (Farsi)',
  '한국어',
  'Ojibwe (Anishinaabemowin)',
];

interface Msg {
  role: 'patient' | 'assistant';
  text: string;
  /** UI-only notice (e.g. "busy"); not sent back to the model as conversation history. */
  notice?: boolean;
}

export function PatientDrawer({ plan, snapshot, onClose }: { plan: PlanJSON; snapshot: () => string; onClose: () => void }) {
  const [lang, setLang] = useState('English');
  const [text, setText] = useState<string | null>(null);
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [ttsOk, setTtsOk] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const reqId = useRef(0); // only the latest explain() may write (language can change mid-request)

  useEffect(() => {
    let live = true;
    getHealth().then((h) => live && setTtsOk(h.tts));
    return () => {
      live = false;
      audio.current?.pause();
    };
  }, []);

  const explain = async (language: string) => {
    const id = ++reqId.current;
    setBusy(true);
    setText(null);
    setSrc('');
    let image: string | undefined;
    try {
      image = snapshot();
    } catch {
      image = undefined; // the picture is optional
    }
    try {
      const r = await post<{ text: string; source: string }>('/api/patient-explain', { plan, language, image });
      if (id !== reqId.current) return;
      setText(r.text);
      setSrc(r.source);
    } catch {
      if (id !== reqId.current) return;
      setText(patientTemplate(plan));
      setSrc('template');
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  };

  useEffect(() => {
    explain(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // braces matter: scrollIntoView now returns a Promise, and React would call a returned value as a cleanup function
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const ask = async () => {
    const question = q.trim();
    if (!question || asking) return;
    setQ('');
    setAsking(true);
    const history = msgs.filter((m) => !m.notice).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: 'patient', text: question }]);
    try {
      const r = await post<{ text: string }>('/api/patient-chat', { plan, language: lang, history, question });
      setMsgs((m) => [...m, { role: 'assistant', text: r.text }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: CHAT_BUSY, notice: true }]);
    } finally {
      setAsking(false);
    }
  };

  const listen = async () => {
    if (!text) return;
    setAudioBusy(true);
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: lang }),
      });
      if (!r.ok) throw new Error('tts failed');
      const url = URL.createObjectURL(await r.blob());
      audio.current?.pause();
      audio.current = new Audio(url);
      await audio.current.play();
    } catch {
      setTtsOk(false); // read-aloud isn't working: hide the button rather than show an error
    } finally {
      setAudioBusy(false);
    }
  };

  return (
    <div className="drawer patient">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">For the patient</div>
          <h2>Your biopsy</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="drawer-body">
        <div className="lang-row">
          <select
            value={lang}
            onChange={(e) => {
              setLang(e.target.value);
              explain(e.target.value);
            }}
          >
            {LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          {ttsOk && (
            <button className="btn ghost" disabled={!text || audioBusy} onClick={listen}>
              {audioBusy ? 'Preparing…' : 'Listen'}
            </button>
          )}
        </div>
        {busy && <div className="skeleton">Writing in {lang}…</div>}
        {text && <div className="patient-text md" dangerouslySetInnerHTML={{ __html: mdToHtml(text) }} />}
        {src && <div className="src">{sourceLabel(src)}</div>}

        <div className="section-label">Questions</div>
        <div className="chat">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`} dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
          ))}
          {asking && <div className="bubble assistant skeleton">Thinking…</div>}
          <div ref={bottom} />
        </div>
        <div className="chat-input">
          <input
            value={q}
            placeholder="Ask a question"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
          />
          <button className="btn" onClick={ask} disabled={asking}>
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
