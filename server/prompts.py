"""Prompt templates. The engine's structured plan is the single source of truth for every number."""
from __future__ import annotations

import json
from typing import Any

DOCTOR_SYSTEM = """You are a thoracic interventional radiology planning assistant inside Pathfinder,
a decision-support tool for CT-guided percutaneous lung biopsy. You write the procedure plan for the
operating physician.

Rules:
- Use ONLY the numbers and facts in the provided PLAN JSON. Never invent measurements, risks, or anatomy.
- Be concise and clinical. Use markdown with these sections, in order:
  **Target**, **Approach** (position, entry site, intercostal space, angle, tilt, depths, needle),
  **What this path avoids**, **What it cannot avoid**, **Risk estimate** (with the drivers),
  **Post-procedure monitoring**, **Alternatives considered** (if present).
- Risk numbers are model estimates from published odds ratios applied to this anatomy; say so once.
- End with one line: "Decision support only — final trajectory per operator judgment on the planning CT."
"""

PATIENT_SYSTEM = """You explain an upcoming lung biopsy to a patient, using their own scan.
Write in the requested language at a ~6th-grade reading level: short sentences, warm, calm, honest.

Rules:
- Use ONLY facts from the PLAN JSON. Do not invent numbers. Round numbers simply ("about 5 cm").
- The spot has NOT been diagnosed. Call it "a spot" or "a small area" that needs a tiny sample to find out
  what it is. Never say cancer unless the patient asks; if so, say only the sample will tell.
- Explain: why the sample is needed; how they will lie; where the needle goes in (on their body, in plain
  words); what the doctor's plan carefully avoids; the most common risk (a small air leak / partly collapsed
  lung) with the estimated chance, what it feels like, and that it is usually watched or treated simply;
  what happens after (rest, a chest X-ray, symptoms to report right away).
- If an image is provided, it is a 3D view of THEIR body from the planning tool: you may refer to it
  ("in the picture, the orange dot is the spot").
- No markdown headings; 4-6 short paragraphs or a short list. Under 280 words.
- Finish by inviting questions and reminding them their doctor makes the final decisions.
"""

CHAT_SYSTEM = """You answer a patient's questions about their planned lung biopsy, in their language,
grounded in the PLAN JSON (their own anatomy and plan). Plain language, warm, brief (under 120 words).
Never invent numbers. Never give a diagnosis. If a question is outside the plan (e.g. medication changes,
whether to stop blood thinners, results), say their care team will answer that and suggest what to ask.
If they describe urgent symptoms (trouble breathing, chest pain, coughing blood), tell them to get help right away."""


def _plan(plan: dict[str, Any]) -> str:
    return json.dumps(plan, indent=1, ensure_ascii=False)


def doctor_user(plan: dict[str, Any]) -> str:
    return f"PLAN JSON:\n{_plan(plan)}\n\nWrite the procedure plan."


def patient_user(plan: dict[str, Any], language: str) -> str:
    return f"Language: {language}\n\nPLAN JSON:\n{_plan(plan)}\n\nWrite the explanation for the patient."


def chat_user(plan: dict[str, Any], language: str, history: str, question: str) -> str:
    return (f"Language: {language}\n\nPLAN JSON:\n{_plan(plan)}\n\nConversation so far:\n{history or '(none)'}\n\n"
            f"Patient's question: {question}")


# ---------------------------------------------------------------- template fallbacks (no API key)
def _pct(x: Any) -> str:
    try:
        return f"{float(x) * 100:.0f}%"
    except Exception:
        return str(x)


def doctor_template(p: dict[str, Any]) -> str:
    g, r, m = p.get("geometry", {}), p.get("risk", {}), p.get("measurements", {})
    lines = [
        f"**Target** — {p.get('target', {}).get('description', '')}",
        "",
        "**Approach**",
        f"- Position: {g.get('positionText', '')}",
        f"- Entry: {g.get('entryText', '')}",
        f"- Angle: {g.get('angleText', '')}; {g.get('tiltText', '')}",
        f"- Depths: skin→pleura {m.get('chestWallMm', '?')} mm, aerated lung {m.get('aeratedLungMm', '?')} mm, skin→lesion edge {m.get('lesionDepthMm', '?')} mm",
        f"- Needle: {g.get('needleText', '')}",
        "",
        "**What this path avoids**",
        *[f"- {a}" for a in p.get("avoids", [])],
        "",
        "**What it cannot avoid**",
        *[f"- {a}" for a in p.get("cannotAvoid", [])],
        "",
        f"**Risk estimate** — pneumothorax {_pct(r.get('pneumothorax'))}, chest tube {_pct(r.get('chestTube'))}, "
        f"pulmonary haemorrhage {_pct(r.get('haemorrhage'))} (model estimates from published odds ratios).",
        "",
        "**Post-procedure monitoring**",
        *[f"- {a}" for a in p.get("watchFor", [])],
        "",
        "_Decision support only — final trajectory per operator judgment on the planning CT._",
    ]
    return "\n".join(lines)


def patient_template(p: dict[str, Any]) -> str:
    g, r = p.get("geometry", {}), p.get("risk", {})
    return (
        "Your scan shows a small spot in your lung. To find out what it is, your doctor will take a tiny sample "
        "with a thin needle, guided by a CT scanner.\n\n"
        f"You will lie {g.get('positionPlain', 'comfortably')}. The needle will go in through the skin on your "
        f"{g.get('entryPlain', 'chest')}. The plan was chosen to stay away from blood vessels and other delicate areas.\n\n"
        f"The most common problem is a small air leak around the lung. For a path like yours, the estimated chance is "
        f"about {_pct(r.get('pneumothorax'))}. Most leaks are small and just watched; some need a small tube for a short time.\n\n"
        "Afterwards you will rest and have a chest X-ray. Tell the team right away if you feel short of breath, have chest "
        "pain, or cough up blood.\n\nPlease ask any questions. Your doctor makes the final decisions."
    )
