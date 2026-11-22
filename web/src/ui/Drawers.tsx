import { useEffect, useRef, useState } from 'react';
import type { PlanJSON } from '../engine/plan';
import { mdToHtml } from './md';

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function DoctorDrawer({ plan, onClose }: { plan: PlanJSON; onClose: () => void }) {
  const [md, setMd] = useState<string | null>(null);
  const [src, setSrc] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const g = plan.geometry;
  useEffect(() => {
    let live = true;
    setMd(null);
    post<{ markdown: string; source: string; error?: string }>('/api/doctor-plan', { plan })
      .then((r) => {
        if (!live) return;
        setMd(r.markdown);
        setSrc(r.source);
        if (r.error) setErr(r.error);
      })
      .catch((e) => live && setErr(String(e)));
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
          Narrative {src && <span className="src">{src === 'template' ? 'template' : src}</span>}
        </div>
        {md === null && !err && <div className="skeleton">Writing…</div>}
        {md && <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(md) }} />}
        {err && <div className="error">{err}</div>}
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
}

export function PatientDrawer({ plan, snapshot, onClose }: { plan: PlanJSON; snapshot: () => string; onClose: () => void }) {
  const [lang, setLang] = useState('English');
  const [text, setText] = useState<string | null>(null);
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const explain = async (language: string) => {
    setBusy(true);
    setText(null);
    try {
      const r = await post<{ text: string; source: string }>('/api/patient-explain', { plan, language, image: snapshot() });
      setText(r.text);
      setSrc(r.source);
    } catch (e) {
      setText(`Could not reach the explanation service: ${e}`);
    } finally {
      setBusy(false);
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
    if (!question) return;
    setQ('');
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: 'patient', text: question }]);
    try {
      const r = await post<{ text: string }>('/api/patient-chat', { plan, language: lang, history, question });
      setMsgs((m) => [...m, { role: 'assistant', text: r.text }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: `Sorry — the assistant is unavailable (${e}).` }]);
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
      if (!r.ok) throw new Error(await r.text());
      const url = URL.createObjectURL(await r.blob());
      audio.current?.pause();
      audio.current = new Audio(url);
      await audio.current.play();
    } catch (e) {
      alert(`Text-to-speech unavailable: ${e}`);
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
          <button className="btn ghost" disabled={!text || audioBusy} onClick={listen}>
            {audioBusy ? 'Preparing…' : 'Listen'}
          </button>
        </div>
        {busy && <div className="skeleton">Writing in {lang}…</div>}
        {text && <div className="patient-text md" dangerouslySetInnerHTML={{ __html: mdToHtml(text) }} />}
        {src && <div className="src">{src === 'template' ? 'Template (no Gemini key)' : `Gemini ${src}`}</div>}

        <div className="section-label">Questions</div>
        <div className="chat">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`} dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
          ))}
          <div ref={bottom} />
        </div>
        <div className="chat-input">
          <input
            value={q}
            placeholder="Ask a question"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
          />
          <button className="btn" onClick={ask}>
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
