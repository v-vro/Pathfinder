// Offline templates: what the drawers show when the API can't be reached at all.
// Mirrors doctor_template / patient_template in server/prompts.py, so the text is the same whether the
// server or the browser falls back.
import type { PlanJSON } from '../engine/plan';

const pct = (x: number | null | undefined) => (typeof x === 'number' && isFinite(x) ? `${(x * 100).toFixed(0)}%` : '?');
const mm = (x: number | null | undefined) => (typeof x === 'number' ? String(x) : '?');

export function doctorTemplate(p: PlanJSON): string {
  const g = p.geometry;
  const r = p.risk;
  const m = p.measurements;
  return [
    `**Target** — ${p.target.description}`,
    '',
    '**Approach**',
    `- Position: ${g.positionText}`,
    `- Entry: ${g.entryText}`,
    `- Angle: ${g.angleText}; ${g.tiltText}`,
    `- Depths: skin→pleura ${mm(m.chestWallMm)} mm, aerated lung ${mm(m.aeratedLungMm)} mm, skin→lesion edge ${mm(m.lesionDepthMm)} mm`,
    `- Needle: ${g.needleText}`,
    '',
    '**What this path avoids**',
    ...p.avoids.map((a) => `- ${a}`),
    '',
    '**What it cannot avoid**',
    ...p.cannotAvoid.map((a) => `- ${a}`),
    '',
    `**Risk estimate** — pneumothorax ${pct(r.pneumothorax)}, chest tube ${pct(r.chestTube)}, ` +
      `pulmonary haemorrhage ${pct(r.haemorrhage)} (model estimates from published odds ratios).`,
    '',
    '**Post-procedure monitoring**',
    ...p.watchFor.map((a) => `- ${a}`),
    '',
    '_Decision support only — final trajectory per operator judgment on the planning CT._',
  ].join('\n');
}

export function patientTemplate(p: PlanJSON): string {
  const g = p.geometry;
  return [
    'Your scan shows a small spot in your lung. To find out what it is, your doctor will take a tiny sample ' +
      'with a thin needle, guided by a CT scanner.',
    `You will lie ${g.positionPlain || 'comfortably'}. The needle will go in through the skin on your ` +
      `${g.entryPlain || 'chest'}. The plan was chosen to stay away from blood vessels and other delicate areas.`,
    'The most common problem is a small air leak around the lung. For a path like yours, the estimated chance is ' +
      `about ${pct(p.risk.pneumothorax)}. Most leaks are small and just watched; some need a small tube for a short time.`,
    'Afterwards you will rest and have a chest X-ray. Tell the team right away if you feel short of breath, have chest ' +
      'pain, or cough up blood.',
    'Please ask any questions. Your doctor makes the final decisions.',
  ].join('\n\n');
}

/** Label for where a text came from: a Gemini model name, or "template". */
export const sourceLabel = (src: string) => (src === 'template' ? 'Offline template' : `Gemini ${src}`);

export const CHAT_BUSY = 'The assistant is busy, try again in a moment.';
