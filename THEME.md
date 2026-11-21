# Pathfinder theme

The design system for every Pathfinder screen: the landing page, `/planner`, `/hologram` and anything added later.

## The rules

1. **All UI uses the variables in `src/theme.css` and the components in `src/components/`.** Don't hard-code hex values, font names, pixel spacing or shadows.
2. **No new colours or fonts.** If something seems to need one, ask Ibrahim first. Don't add it in place.
3. **Strictly black and white.** The whole UI is greyscale: black background, near-black panels, white text and actions. The only colours anywhere are the three risk markers.
4. **Risk colours mean risk, nothing else.** `--risk-safe`, `--risk-caution` and `--risk-danger` are reserved for the planner's 3D view: needle path segments, the skin safe-zone map, the target, and the risk breakdown. Never use them for regular UI (buttons, links, badges, focus, decoration). On the landing page they don't appear at all; the hero is anatomy only.
5. **Never colour alone.** Red and green look alike to many colour-blind people, so wherever a risk colour appears, also show a word or icon: "Safe" ✓, "Caution" ⚠, "Danger" ✕. Use `<RiskLabel>`.
6. **Respect reduced motion.** Duration tokens drop to `0ms` under `prefers-reduced-motion`; use them instead of literal durations. `DitherCanvas` handles this itself.
7. No stock photos, realistic anatomy, blood or red crosses.

`src/theme.css` is imported once in `src/main.tsx`. Component styles live in `src/components/components.css`, and each component imports it itself.

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

#### Risk markers (the only colours)

| Token            | Value            | Meaning       | Always shown with                |
| ---------------- | ---------------- | ------------- | -------------------------------- |
| `--risk-safe`    | `#22C55E` green  | Low risk      | ✓ check and "Safe"               |
| `--risk-caution` | `#EAB308` yellow | Elevated risk | ⚠ warning triangle and "Caution" |
| `--risk-danger`  | `#EF4444` red    | High risk     | ✕ cross and "Danger"             |

Reserved for the planner's 3D view: needle path segments, the skin safe-zone map, the target, and the risk breakdown. The landing page is fully monochrome. If a risk preview is ever added there, it needs a labelled legend.

In the 3D view, a coloured segment or heat-map region must have a nearby label, tooltip or legend entry with the word and icon. In the risk breakdown, each row shows `<RiskLabel>` next to its number. Don't use risk colours for button fills, badge tones, borders or text emphasis.

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

| Token                                                         | Value                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `--font-sans`                                                 | Manrope (variable), for all UI text                                                  |
| `--font-mono`                                                 | JetBrains Mono (variable), for data labels, units, coordinates, small technical text |
| `--text-xs` … `--text-2xl`                                    | 12, 14, 16, 18, 22, 28px                                                             |
| `--text-3xl`                                                  | fluid 32 to 44px (section titles)                                                    |
| `--text-display`                                              | fluid 40 to 68px (page hero only)                                                    |
| `--text-stat`                                                 | fluid 48 to 88px (big numbers)                                                       |
| `--weight-regular` / `medium` / `semibold` / `bold` / `black` | 400 / 500 / 600 / 700 / 800                                                          |
| `--leading-tight` / `snug` / `normal`                         | 1.1 / 1.3 / 1.6                                                                      |

Both fonts are self-hosted via `@fontsource-variable`, so they work offline at the venue.

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
import { Button, Panel, SectionHeader, Toggle, Badge, DitherCanvas } from "../components";
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
<Toggle checked={showVessels} onChange={setShowVessels} label="Vessels" hint="V" />
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
import { DitherCanvas, type DitherSceneSetup, createMarkerMaterial } from "../components";

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
  const target = new THREE.Mesh(new THREE.SphereGeometry(0.1), createMarkerMaterial("fg"));
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

<DitherCanvas setup={setup} pixelSize={3} style={{ height: 400 }} label="Rotating knot" />;
```

How it works: the scene renders into a low-resolution target (2×2 samples per dither cell). A full-screen shader then takes each cell's luminance and thresholds it against a 4×4 or 8×8 Bayer matrix into `bg` / `fg` (or `bg` → `mid` → `fg` with `levels={3}`). Cells are `pixelSize` CSS pixels, scaled by `devicePixelRatio` and rounded, so they stay square and crisp on retina screens. The 3D work runs at a fraction of full resolution, which keeps it at 60 fps. The loop pauses when the canvas is off-screen or the tab is hidden. With reduced motion it draws a single still frame.

**Colouring things.** Shade ordinary objects with neutral (grey/white) lit materials; brightness becomes the dither pattern. Keep large surfaces dark-ish, because in 1-bit mid-greys turn into heavy speckle. Let bone, needles and targets carry the image. Marker helpers:

- `createMarkerMaterial("fg")` draws solid white. Use it for needles, targets, scan planes and highlights.
- `createMarkerMaterial("safe" | "caution" | "danger")` draws in a risk colour. Only for risk meaning, and only with a labelled legend nearby (see the hero's `<RiskLabel>` legend).
- `ditherMarkerColor(kind, intensity)` fades a marker (it dithers out). `createGlowSprite(kind, size)` makes a soft dithered halo.

Props: `setup`, `pixelSize` (default 3), `levels` (2 or 3; default from `--dither-levels`), `matrix` (4 or 8), `palette` (override any of `bg`/`mid`/`fg`/`safe`/`caution`/`danger` with a theme variable name, e.g. `{ fg: "--color-text-muted" }`), `contrast`, `brightness`, `paused`, `label` (set it for meaningful images, leave it off for decorative ones), `className`, `style`. The element fills its container, so give it a size.

`src/pages/landing/HeroAnatomy.tsx` shows a full example, in two views:

- `view="hero"` (landing hero): only the anatomy (ribs, spine, lungs), with no needle or markers. It is interactive (`scenes/heroControls.ts`). It follows the mouse up to ±60° left-right and ±25° up-down with damping. Drag spins it a full 360°, the wheel or a pinch zooms in a little, it drifts back after release, and it auto-rotates when idle. Touch drag works on phones, and vertical swipes still scroll the page. With reduced motion there is no auto-rotate, the follow range is smaller, and it snaps to input instead of easing. `onFirstInteraction` fires once, which the landing page uses to fade its hint.
- `view="poster"` (demo poster): slow sway with a white needle. Set `riskPreview` and `needle.segments` to colour the path with risk markers.

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

## Building `/planner` with the theme

- Replace `src/pages/Planner.tsx` (currently a placeholder). It is lazy-loaded, so its code doesn't weigh down the landing page.
- It already renders inside `Layout`. For a full-screen tool without the footer, move its route into its own `<Route element={<Layout hideFooter />}>` group in `src/App.tsx` (ask Ibrahim, since `App.tsx` is shared).
- Tool chrome: put side panels and controls in `Panel`, and the 3D viewport and CT slice view in `Panel variant="inset" padding="none"`. Use `SectionHeader as="h3"` or plain `h3` for panel titles, `Toggle` for layer visibility (skin, ribs, vessels…), and `Badge` for status.
- Numbers, units and coordinates use `.pf-mono`.
- UI chrome is monochrome. The one big action (e.g. "Find safest path") is the white `primary` button; everything else is `secondary` or `ghost`.
- In the 3D view, colour needle path segments, the skin safe-zone map, the target and the risk breakdown with `--risk-safe` / `--risk-caution` / `--risk-danger`. Everything else in the 3D view (anatomy, unscored needle, guides) is greyscale. Give every coloured element a word and icon (`<RiskLabel>`) in a legend, tooltip or breakdown row.
- The planner's main 3D view doesn't need to be dithered. A normal three.js renderer on `--color-bg-deep` with greyscale materials matches the brand. To read a token in JS: `getComputedStyle(document.documentElement).getPropertyValue("--risk-safe")`.
- For the skin heat map, use the three risk tokens as bands, or blend only between neighbouring ones (safe↔caution↔danger). Don't introduce any other hue, and include a legend that uses `<RiskLabel>`.
