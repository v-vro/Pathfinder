# Pathfinder theme

The design system for every Pathfinder screen: the landing page, `/planner`, `/hologram` and anything added later.

## The rules

1. **All UI uses the variables in `src/theme.css` and the components in `src/components/`.** Don't hard-code hex values, font names, pixel spacing or shadows.
2. **No new colours or fonts.** If something seems to need one, ask Ibrahim first. Don't add it in place.
3. **Strictly black and white.** The whole UI is greyscale: black background, near-black panels, white text and actions. The only colours anywhere are the three risk markers and the needle blue, each reserved for one job.
4. **Risk colours mean risk, nothing else.** `--risk-safe`, `--risk-caution` and `--risk-danger` are reserved for the planner's 3D view: needle path segments, the skin safe-zone map, the target, and the risk breakdown. Never use them for regular UI (buttons, links, badges, focus, decoration). The one exception is the landing hero's decorative needle search (below).
5. **Never colour alone.** Red and green look alike to many colour-blind people, so wherever a risk colour appears, also show a word or icon: "Safe" ✓, "Caution" ⚠, "Danger" ✕. Use `<RiskLabel>`.
6. **Respect reduced motion.** Duration tokens drop to `0ms` under `prefers-reduced-motion`; use them instead of literal durations. `DitherCanvas` handles this itself.
7. No stock photos, realistic anatomy, blood or red crosses.

`src/theme.css` is imported by `src/components/Layout.tsx`, so it only loads with the site pages. Its page-wide rules only apply while `<html>` has the `pf-site` class, which `Layout` adds and removes. Component styles live in `src/components/components.css`, and each component imports it itself.

### How the site and the planner share this app

- `src/main.tsx` renders `src/Root.tsx`, which holds the routes. `/planner` is the planner (`src/App.tsx`, unchanged). Everything else (`/` and a 404) is `src/pages/SiteRoutes.tsx` inside `Layout`.
- Both sides are lazy-loaded, so each page loads only its own code and CSS. The planner keeps its own global styles in `src/index.css`.
- The site links to `/planner` with a full page load (`<Button href>`, not `to`). The planner then still mounts exactly once per page load, as its no-StrictMode comment requires.
- A production host must serve `index.html` for `/planner` and other routes (SPA fallback). `vite dev` and `vite preview` already do.

---

## Tokens

### Colour

Always use the **semantic** tokens. The raw `--pf-*` greyscale exists only so the semantic tokens have something to point at.

**Greyscale scale (raw):** `--pf-black` `#000000` · `--pf-grey-950` `#0A0A0A` · `-900` `#141414` · `-850` `#1A1A1A` · `-800` `#262626` · `-700` `#404040` · `-600` `#5C5C5C` · `-500` `#8A8A8A` · `-200` `#D4D4D4` · `--pf-white` `#FFFFFF`.

| Token                                           | Value             | Use                                                                          |
| ----------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `--color-bg`                                    | `#000000`         | Page background                                                              |
| `--color-bg-deep`                               | `#000000`         | Footer, inset wells, video/3D viewports (same as bg; separated by borders)   |
| `--color-surface`                               | `#0A0A0A`         | Panels and cards                                                             |
| `--color-surface-raised`                        | `#141414`         | Panels on panels, badges, popovers                                           |
| `--color-surface-hover`                         | `#1A1A1A`         | Hovered rows, list items and cards                                           |
| `--color-border`                                | `#262626`         | Default 1px borders (elevation comes from borders, not shadows)              |
| `--color-border-strong`                         | `#404040`         | Inputs, toggles, emphasised dividers                                         |
| `--color-primary`                               | `#FFFFFF`         | Links, outlines, active states                                               |
| `--color-primary-hover`                         | `#D4D4D4`         | Hover for white text and outlines                                            |
| `--color-primary-soft`                          | white @ 8%        | Subtle fills (icon tiles, selected rows, secondary button)                   |
| `--color-primary-border`                        | `#FFFFFF`         | Outlines (secondary button, hovered cards, emphasised badge)                 |
| `--color-on-primary`                            | `#000000`         | Text on a white fill                                                         |
| `--color-accent`                                | `#FFFFFF`         | Fill of the single main call to action, highlights                           |
| `--color-accent-hover`                          | `#D4D4D4`         | Hover for the main CTA                                                       |
| `--color-accent-soft` / `--color-accent-border` | white @ 8% / 40%  | Highlight tints and outlines                                                 |
| `--color-on-accent`                             | `#000000`         | Text on the main CTA                                                         |
| `--color-text`                                  | `#FFFFFF`         | Headings and body                                                            |
| `--color-text-muted`                            | `#8A8A8A`         | Secondary text, captions, labels                                             |
| `--color-text-disabled`                         | `#5C5C5C`         | Disabled text and icons (exempt from contrast rules, but never the only cue) |
| `--color-focus`                                 | `#FFFFFF`         | Focus outlines (set globally on `:focus-visible`)                            |
| `--color-bg-translucent`                        | black @ 80%       | Sticky navbar behind the blur                                                |
| `--color-scrim` / `--color-scrim-strong`        | black @ 55% / 85% | Overlays and label backings on top of graphics                               |

`primary` and `accent` keep their names so components don't change; both are white now. `primary` is for outlines and links, and `accent` is the solid white fill of the one main action.

The `@ n%` tokens are built with `color-mix()` from the raw palette. Never write `rgb(… / alpha)` in component CSS; add or use one of these tokens instead.

#### Risk markers and the needle (the only colours)

| Token            | Value            | Meaning       | Always shown with                |
| ---------------- | ---------------- | ------------- | -------------------------------- |
| `--risk-safe`    | `#22C55E` green  | Low risk      | ✓ check and "Safe"               |
| `--risk-caution` | `#EAB308` yellow | Elevated risk | ⚠ warning triangle and "Caution" |
| `--risk-danger`  | `#EF4444` red    | High risk     | ✕ cross and "Danger"             |

Reserved for the planner's 3D view: needle path segments, the skin safe-zone map, the target, and the risk breakdown. **Landing hero exception:** the hero shows a decorative needle search. A blue (`--needle`) needle tries entry points one at a time, and each finished track takes a risk colour with a label (icon, word and short reason, e.g. "✕ Blocked by rib", "✓ Safe · clear rib gap"). The page notes "illustrative risks". The needle itself never takes a risk colour. No precise numbers appear there. The rest of the landing page is monochrome.

In the 3D view, a coloured segment or heat-map region must have a nearby label, tooltip or legend entry with the word and icon. In the risk breakdown, each row shows `<RiskLabel>` next to its number. Don't use risk colours for button fills, badge tones, borders or text emphasis.

**Needle:** `--needle` `#3B82F6` (electric blue) is reserved for the biopsy needle, in the landing hero and in the planner's 3D view. Don't use it for UI, links, focus or risk. It sits apart from the white bones and from all three risk colours, so the needle never reads as a risk level. Risk colours go on the track or path behind the needle, never on the needle itself. Render it solid and undithered with simple metal shading, and optionally a brighter tip and a soft glow (see `scenes/needleSearch.ts`). Keep the shaft at least 2–3 px wide on screen. It is 5.7:1 against black.

**Contrast (WCAG 2.1):**

| Text                 | on bg  | on surface | on surface-raised | on surface-hover |
| -------------------- | ------ | ---------- | ----------------- | ---------------- |
| `--color-text`       | 21.0:1 | 19.8:1     | 18.4:1            | 17.4:1           |
| `--color-text-muted` | 6.1:1  | 5.7:1      | 5.3:1             | 5.0:1            |
| `--risk-safe`        | 9.2:1  | 8.7:1      | 8.1:1             | 7.7:1            |
| `--risk-caution`     | 11.0:1 | 10.3:1     | 9.6:1             | 9.1:1            |
| `--risk-danger`      | 5.6:1  | 5.3:1      | 4.9:1             | 4.7:1            |

Black on white (primary button) is 21:1, and black on `#D4D4D4` (hover) is 14.2:1. Every pair above passes AA. Don't put risk text on `--color-border` grey (`#262626`); red drops to 4.0:1 there. The 1px borders (about 1.4:1) are decorative separators. Don't rely on a border alone to show that something is a control or what state it is in.

**Dither palette**, read at runtime by `DitherCanvas`: `--dither-bg` `#000000` (must equal `--color-bg` so canvases have no visible edge), `--dither-fg` `#FFFFFF`, `--dither-levels: 2` (1-bit). `--dither-mid` `#404040` is only used by a canvas that opts into `levels={3}`. Risk markers in dithered scenes are drawn with the `--risk-*` tokens.

**Logo:** `--logo-filter: brightness(0) invert(1)` turns the current colour logo pure white. When a proper monochrome export exists, save it as `public/logo-on-dark.png` and set `--logo-filter: none`.

### Type

| Token                                                         | Value                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `--font-body`                                                 | EB Garamond (the planner's reading font), for all UI text                                            |
| `--font-mono`                                                 | IBM Plex Mono (the planner's figure font), for data labels, units, coordinates, small technical text |
| `--text-xs` … `--text-2xl`                                    | 12, 14, 16, 18, 22, 28px                                                                             |
| `--text-3xl`                                                  | fluid 32 to 44px (section titles)                                                                    |
| `--text-display`                                              | fluid 40 to 68px (page hero only)                                                                    |
| `--text-stat`                                                 | fluid 48 to 88px (big numbers)                                                                       |
| `--weight-regular` / `medium` / `semibold` / `bold` / `black` | 400 / 500 / 600 / 600 / 600 (capped at 600, the heaviest Garamond weight loaded)                     |
| `--leading-tight` / `snug` / `normal`                         | 1.1 / 1.3 / 1.6                                                                                      |

Both fonts are the planner's own, loaded for every page by the Google Fonts link in `index.html`: EB Garamond 400, 500 and 600 (with italics) and IBM Plex Mono 400 and 500. Don't use weights outside those, or the browser fakes them. They load from Google, so the venue needs internet (or self-host them later).

The `.pf-mono` utility class gives the standard small uppercase technical label (mono, 12px, tracked). Use it for readouts like `DEPTH 62 MM` or `ENTRY · RIB 5–6`.

### Spacing, radius, shadow, motion, layout

| Group              | Tokens                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spacing (4px base) | `--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 24 · `-6` 32 · `-7` 48 · `-8` 64 · `-9` 96 · `-10` 128                                                                 |
| Radius             | `--radius-sm` 6 · `-md` 10 · `-lg` 16 (panels) · `-xl` 24 · `-pill`                                                                                                      |
| Shadow             | `--shadow-sm` (none) · `-md` (1px lift) · `-lg` (soft, hover only) · `--shadow-inset` · `--shadow-glow-primary` · `--shadow-glow-accent`. Prefer borders for separation. |
| Motion             | `--ease-out`, `--ease-in-out`, `--duration-fast` 140ms · `-base` 240ms · `-slow` 700ms (all 0 with reduced motion)                                                       |
| Layout             | `--container-max` 1200px, `--container-pad`, `--nav-height` 64px, `--z-nav`, `--z-overlay`                                                                               |

### Utility classes

`.pf-container` (centred max-width column with side padding), `.pf-mono`, `.pf-muted`, `.pf-visually-hidden`.

---

## Components

Import from `src/components` (barrel) or the individual file.

```tsx
import {
  Button,
  Panel,
  SectionHeader,
  Toggle,
  Badge,
  DitherCanvas,
} from "../components";
```

### Button

```tsx
<Button variant="primary" to="/planner">Try the planner</Button>     // router link
<Button variant="secondary" onClick={compute}>Compute path</Button>  // <button>
<Button variant="ghost" href="https://…" target="_blank">Docs</Button> // <a>
```

- `variant`: `primary` is a white fill with black text, for the **one** main action per view. `secondary` is outlined in white (the default). `ghost` is low emphasis.
- `size`: `sm` | `md` | `lg`. Also `iconStart`, `iconEnd`, `fullWidth`, and all native button/link props (`disabled`, `aria-*`, …).

### Panel

Card container. `variant`: `default` (surface), `raised` (lighter, for nesting), `inset` (recessed, for 3D viewports, CT slice views and video). `padding`: `none` | `sm` | `md` | `lg`. `interactive` adds a hover lift. `as` changes the element.

### SectionHeader

`eyebrow` (mono label), `title`, `description`, `align` (`start` | `center`), `as` (`h1` | `h2` | `h3`, default `h2`).

### Toggle

Accessible switch (`role="switch"`). Controlled:

```tsx
<Toggle
  checked={showVessels}
  onChange={setShowVessels}
  label="Vessels"
  hint="V"
/>
```

### Badge

Small mono pill. `tone`: `neutral` | `primary` (emphasised, white outline) | `accent` (emphasised). `dot` adds a status dot. Badges are monochrome and never show risk; use `RiskLabel` for that.

### RiskLabel

The only way to show a risk colour in UI: the colour, an icon and a word together.

```tsx
<RiskLabel level="safe" />                 // ✓ SAFE in green
<RiskLabel level="caution">Pleura crossed</RiskLabel>
<RiskLabel level="danger" iconOnly />      // ✕ icon, "Danger" kept for screen readers
```

`iconOnly` is only for places where the word is already next to it (e.g. a table column headed "Risk").

### NavBar, Footer, Layout, Logo

`Layout` is the shared page shell (NavBar, `<main id="main">`, Footer). It is a router layout route in `src/App.tsx`, so every page inside it gets the shell. It also handles `/#section` hash links and scroll-to-top on navigation. `NavBar` takes `links` and `action`. Nav links and team names live in `src/components/siteConfig.ts`. `Logo` renders `public/logo-on-dark.png` with `--logo-filter` applied (pure white for now).

### Reveal

Wrap a block to fade it in on scroll: `<Reveal delay={100}>…</Reveal>`. It does nothing under reduced motion. Use it on marketing pages, not in tool UI.

### DitherCanvas

A three.js scene drawn through an ordered (Bayer) dither post-process: 1-bit black and white, so graphics read like a scan.

```tsx
import * as THREE from "three";
import {
  DitherCanvas,
  type DitherSceneSetup,
  createMarkerMaterial,
} from "../components";

// Define at module level (or useMemo) so it isn't rebuilt every render.
const setup: DitherSceneSetup = ({ scene, camera, reducedMotion }) => {
  camera.position.set(0, 0, 4);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(-2, 3, 3);
  scene.add(light);

  const mesh = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.8, 0.25),
    new THREE.MeshStandardMaterial(),
  );
  const target = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    createMarkerMaterial("fg"),
  );
  scene.add(mesh, target);

  return {
    update: ({ time }) => {
      mesh.rotation.y = time * 0.3;
    },
    dispose: () => {
      /* dispose geometries/materials (see disposeObject) */
    },
  };
};

<DitherCanvas
  setup={setup}
  pixelSize={3}
  style={{ height: 400 }}
  label="Rotating knot"
/>;
```

How it works: the scene renders into a low-resolution target (2×2 samples per dither cell). A full-screen shader then takes each cell's luminance and thresholds it against a 4×4 or 8×8 Bayer matrix into `bg` / `fg` (or `bg` → `mid` → `fg` with `levels={3}`). Cells are `pixelSize` CSS pixels, scaled by `devicePixelRatio` and rounded, so they stay square and crisp on retina screens. The 3D work runs at a fraction of full resolution, which keeps it at 60 fps. The loop pauses when the canvas is off-screen or the tab is hidden. With reduced motion it draws a single still frame.

**Colouring things.** Shade ordinary objects with neutral (grey/white) lit materials; brightness becomes the dither pattern. Keep large surfaces dark-ish, because in 1-bit mid-greys turn into heavy speckle. Let bone, needles and targets carry the image. Marker helpers:

- `createMarkerMaterial("fg")` draws solid white. Use it for needles, targets, scan planes and highlights.
- `createMarkerMaterial("safe" | "caution" | "danger")` draws in a risk colour. Only for risk meaning, and only with a labelled legend nearby (see the hero's `<RiskLabel>` legend).
- `ditherMarkerColor(kind, intensity)` fades a marker (it dithers out). `createGlowSprite(kind, size)` makes a soft dithered halo.

Props: `setup`, `pixelSize` (default 3), `levels` (2 or 3; default from `--dither-levels`), `matrix` (4 or 8), `palette` (override any of `bg`/`mid`/`fg`/`safe`/`caution`/`danger` with a theme variable name, e.g. `{ fg: "--color-text-muted" }`), `contrast`, `brightness`, `paused`, `label` (set it for meaningful images, leave it off for decorative ones), `className`, `style`. The element fills its container, so give it a size.

**Crisp overlays.** Return `overlayLayer: 1` from `setup` and put objects on that camera layer (`mesh.layers.set(1)`). They skip the dither and are drawn afterwards at full resolution and antialiased, on top of the 1-bit image. Use unlit materials with `fog: false`. This is how the hero's risk-coloured paths stay sharp.

**Risk icons outside React.** `src/components/riskIcons.ts` exports the icon shapes and words used by `RiskLabel` (`riskIconSvg`, `RISK_WORD`), for labels built in plain DOM.

`src/pages/landing/HeroAnatomy.tsx` shows a full example, in two views:

- `view="hero"` (landing hero): the anatomy (ribs, spine, lungs) plus a decorative needle search (`scenes/needleSearch.ts`). A blue (`--needle`) bevelled needle with a hub, metal shading, a brighter tip and a soft glow advances from outside the chest toward a pulsing white target in the lung. It takes about 0.6 s, slows as it pierces the skin, leaves a grey track, and is scaled so the shaft stays about 3 px wide on screen. The hold after the colour appears is about 0.7 s (longer for the safe attempt), the withdraw about 0.35 s and the gap about 0.2 s, so a sequence takes about 5–6 s. When it stops, the track takes its risk colour and a label appears at the entry. It holds, withdraws and fades, and the last two tracks stay faintly as search history. Each sequence is 2–3 caution, danger or blocked attempts, then a safe one. Everything is drawn crisp on the overlay layer (the scene's lights are enabled on it so the needle is shaded) and rotates with the model. Entries are chosen so the path runs across the screen and stays in view. With reduced motion, one static safe track and its label are shown, with no needle and no loop. It is interactive (`scenes/heroControls.ts`). It follows the mouse up to ±60° left-right and ±25° up-down with damping. Drag spins it a full 360°, the wheel or a pinch zooms in a little, it drifts back after release, and it auto-rotates when idle. Touch drag works on phones, and vertical swipes still scroll the page. With reduced motion there is no auto-rotate, the follow range is smaller, and it snaps to input instead of easing. `onFirstInteraction` fires once, which the landing page uses to fade its hint.
- `view="poster"` (demo poster): slow sway with a white needle. Set `riskPreview` and `needle.segments` to colour the path with risk markers.
- The "Aim and see the risk" card reuses the hero scene through `createHeroScene({ interactive: false, fails: { min: 1, max: 2 } })`, exported as `needleCardScene` from `scenes/anatomy.ts`. It has the same needle, tracks and labels, ignores input, sways gently, centres the model and runs a shorter loop. Like every `DitherCanvas`, it only animates while on screen.

Both take real pipeline meshes:

```tsx
<HeroAnatomy
  models={{
    ribs: "/cases/case01/ribs.glb",
    lungs: "/cases/case01/lungs.glb",
  }}
/>
```

The models are rotated from CT patient space (LPS) to three.js y-up, centred and scaled to fit. If they fail to load, the procedural meshes stay.

---

## Writing

All UI text follows these rules, including the planner's.

- Short. Cut every word that doesn't add meaning. One idea per sentence.
- Plain, specific words. Never use: seamless, empower, revolutionize, unlock, elevate, cutting-edge, harness, leverage, transform, game-changing, robust, journey, landscape, delve, "in today's world".
- No em dashes, rhetorical questions, exclamation marks or emoji. No "not just X, but Y". No lists of exactly three adjectives.
- Active voice and present tense: "Pathfinder scores each route", not "Each route is scored".
- Sentence-case headings, short and concrete.
- Careful medical claims: "helps plan", never "prevents" or "guarantees". Keep the disclaimer and the data credits.

## Using the theme in the planner

The planner currently has its own greyscale styles (`src/index.css`, `App.css`, `pages.css`). If it adopts this theme later:

- Tool chrome: put side panels and controls in `Panel`, and the 3D viewport and CT slice view in `Panel variant="inset" padding="none"`. Use `SectionHeader as="h3"` or plain `h3` for panel titles, `Toggle` for layer visibility (skin, ribs, vessels…), and `Badge` for status.
- Numbers, units and coordinates use `.pf-mono`.
- UI chrome is monochrome. The one big action (e.g. "Find safest path") is the white `primary` button; everything else is `secondary` or `ghost`.
- In the 3D view, colour needle path segments, the skin safe-zone map, the target and the risk breakdown with `--risk-safe` / `--risk-caution` / `--risk-danger`. Everything else in the 3D view (anatomy, unscored needle, guides) is greyscale. Give every coloured element a word and icon (`<RiskLabel>`) in a legend, tooltip or breakdown row.
- The planner's main 3D view doesn't need to be dithered. A normal three.js renderer on `--color-bg-deep` with greyscale materials matches the brand. To read a token in JS: `getComputedStyle(document.documentElement).getPropertyValue("--risk-safe")`.
- For the skin heat map, use the three risk tokens as bands, or blend only between neighbouring ones (safe↔caution↔danger). Don't introduce any other hue, and include a legend that uses `<RiskLabel>`.
