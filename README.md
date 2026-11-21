# Pathfinder

Plan the safest route for a CT-guided lung biopsy needle on a real patient's scan, and explain the plan to the
doctor and the patient. Decision support only.

```
CT (DICOM) ──► TotalSegmentator ──► build_case.py ──► web/public/cases/<id>/   (volumes + meshes + meta)
                                                              │
                     browser: three.js "window" view ◄────────┤  engine (TypeScript): path analysis,
                     head + hand tracking (MediaPipe)         │  evidence-based risk model, safe-zone map,
                     CT slice view following the needle       │  auto-planner, procedure description
                                                              ▼
                     FastAPI ──► Gemini: doctor narrative, patient explanation (any language), Q&A, TTS
```

## Run it

```bash
# 1. Python (pipeline + API)
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt

# 2. Web
cd web && npm install && cd ..

# 3. (only if web/public/cases/lidc-0742 is missing) build the demo case, ~15 min on CPU
.venv/Scripts/python pipeline/fetch_case.py           # public LIDC-IDRI chest CT from TCIA (CC BY 3.0)
.venv/Scripts/python pipeline/segment.py              # TotalSegmentator: fast total + lung vessels
.venv/Scripts/python pipeline/segment.py --full --skip-vessels   # optional: full-res anatomy (better lobes/fissures)
.venv/Scripts/python pipeline/build_case.py           # → web/public/cases/lidc-0742/

# 4. Gemini key (optional: without it the doctor/patient text falls back to templates)
cp .env.example .env    # then paste GEMINI_API_KEY

# 5. Start (two terminals)
.venv/Scripts/python -m uvicorn server.app:app --port 8000
cd web && npm run dev     # http://localhost:5173
```

## Using it

| Action | How |
|---|---|
| Aim the needle | Move the mouse over the body — the needle always points at the nodule, you choose the entry. Or turn on **Hand aim** and point with your index finger. |
| Lock / unlock a path | Click, pinch, or `L` |
| Find the safest path | **⚡ Find safest path** (best + up to 2 alternatives) |
| Look around the body | **Head tracking** (webcam), or arrow keys / `-` `=` to move a virtual head, `0` to reset |
| Turn the patient | Right-drag, or `1` front · `2` back · `3` patient's right · `4` patient's left |
| Whole body ↔ chest | `B`, mouse wheel, or **View ▾** |
| Peel layers | **View ▾** → Peel slider (skin → bones → lungs) and layer toggles |
| Full-screen window effect | `F`, then set your screen width in ⚙ |

## The risk model (the heart)

`web/src/engine/pathAnalysis.ts` marches along the needle through the patient's label volumes and measures what the
literature says matters: aerated lung crossed, fissures crossed, emphysema/bullae on the path, pleural angle,
distance to and calibre of pulmonary vessels, and hard blockers (bone, heart, great vessels, airway, leaving the body).

`web/src/engine/riskModel.ts` turns those into pneumothorax, chest-tube and bleeding estimates with a logistic model
built from published odds ratios, calibrated to pooled meta-analytic rates. Every coefficient and its source is in
[docs/risk-evidence.md](docs/risk-evidence.md) (Heerink 2017, Huo 2020, Drumm 2019, Lee 2016, Zhu 2020, …).
Factors without a published effect size (vessel crossing) are shown as warnings and planner penalties, never as an
invented odds ratio. How far to trust the AI anatomy (lobe/fissure boundaries, vessels, airways) and the safety
margins we apply for it are in [docs/segmentation-confidence.md](docs/segmentation-confidence.md). Each factor's contribution is shown as "percentage points this adds vs. its best value".

`planner.ts` scores every skin vertex as an entry (safe-zone map, ~35k paths in < 0.5 s) and refines the best seeds
with a local search over needle directions. `describe.ts` / `plan.ts` turn the winner into procedure language:
position (incl. evidence-based biopsy-side-down), intercostal space from the segmented ribs, distance from the
spinous processes, angle, tilt, depths, needle length, what it avoids and what it can't.

## Layout

```
pipeline/   fetch_case.py · segment.py · build_case.py         (Python)
server/     app.py (FastAPI + Gemini) · prompts.py
web/src/
  engine/   types · volume · loadCase · pathAnalysis · riskModel · planner · describe · plan
  scene/    Viewer.ts  (three.js, off-axis head-coupled projection, layers, needle, skin heatmap)
  tracking/ tracker.ts (MediaPipe face + hand) · oneEuro.ts
  ui/       RiskPanel · SliceView · Drawers (doctor plan, patient explanation + chat) · md
web/scripts/ engine-check.ts (headless engine test) · screenshot.mjs (visual smoke test)
docs/       risk-evidence.md
```

Data: LIDC-IDRI (Armato et al., Med Phys 2011), via TCIA, CC BY 3.0; nodule location from LUNA16 annotations.
Segmentation: TotalSegmentator (Wasserthal et al., Radiol AI 2023).
