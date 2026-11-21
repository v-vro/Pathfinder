# Pathfinder: shared rules for humans and agents

Hack Western 13 project. Decision-support tool for planning the safest lung biopsy needle path on real CT scans. Targets: Overall, Sun Life Best Health Hack, MLH Gemini.

## Who owns what
- Ibrahim: landing page (`/`), design system (`src/theme.css`, `src/components/`, `THEME.md`).
- Teammate: data pipeline (`pipeline/`) and the planning tool (`/planner`).
- Don't edit the other person's area without asking.

## Design rules
- All UI uses the variables in `src/theme.css` and components in `src/components/`. Read `THEME.md` first.
- No new colours or fonts.

## Data contract (pipeline output -> frontend)
- Output folder: `public/cases/<caseId>/`
- `public/cases/cases.json` lists cases: `[{"id":"case01","label":"Patient 1"}]`
- One `.glb` per structure: skin, ribs, lungs, lobes, vessels, heart, lesion, emphysema
- `meta.json`: voxel spacing (mm), volume origin (mm), lesion centre (mm), best path when computed
- All coordinates in the CT's patient space, in millimetres
- Meshes decimated, each well under 100 MB
- Raw scans are never committed (`data/`, `raw/`, `clean/` are gitignored)

## Git and code
- Pull before starting work. Commit and push small and often.
- `main` must always build and run.
- Run `npm run lint` and Prettier before committing.
- Never commit API keys; use `.env.local`.
