# Pathfinder theme

The design system for every Pathfinder screen: the landing page, `/planner`, `/hologram` and anything added later.

## The rules

1. **All UI uses the variables in `src/theme.css` and the components in `src/components/`.** Don't hard-code hex values, font names, pixel spacing or shadows.
2. **No new colours or fonts.** If something seems to need one, ask Ibrahim first. Don't add it in place.
3. **Amber is reserved.** `--color-accent` is only for targets (the lesion), highlights, and the single main call to action on a view. Everything else interactive is teal.
4. **Respect reduced motion.** Duration tokens drop to `0ms` under `prefers-reduced-motion`; use them instead of literal durations. `DitherCanvas` handles this itself.
5. No stock photos, realistic anatomy, blood or red crosses.

`src/theme.css` is imported once in `src/main.tsx`. Component styles live in `src/components/components.css`, and each component imports it itself.

---

## Tokens

### Colour

Always use the **semantic** tokens. The raw `--pf-*` palette exists only so the semantic tokens have something to point at.

| Token                                    | Value                     | Use                                                             |
| ---------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| `--color-bg`                             | `#050A18` near-black navy | Page background                                                 |
| `--color-bg-deep`                        | `#03060F`                 | Footer, inset wells, video/3D viewports                         |
| `--color-surface`                        | `#0B1426`                 | Panels and cards                                                |
| `--color-surface-raised`                 | `#111C33`                 | Panels on panels, badges, popovers                              |
| `--color-border`                         | `#1A2640`                 | Default 1px borders (elevation comes from borders, not shadows) |
| `--color-border-strong`                  | `#24324F`                 | Inputs, toggles, emphasised dividers                            |
| `--color-primary`                        | `#2CCDB4` teal            | Links, secondary buttons, safe path, active states              |
| `--color-primary-hover`                  | `#62E0CC`                 | Hover for teal elements                                         |
| `--color-primary-soft`                   | teal @ 14%                | Teal tinted backgrounds (icon tiles, selected rows)             |
| `--color-primary-border`                 | teal @ 45%                | Teal outlines (secondary button, hovered cards, teal badge)     |
| `--color-on-primary`                     | `#050A18`                 | Text on a solid teal fill                                       |
| `--color-accent`                         | `#F5B03C` amber           | **Targets, highlights, main CTA only**                          |
| `--color-accent-hover`                   | `#FFC463`                 | Hover for the main CTA                                          |
| `--color-accent-soft`                    | amber @ 14%               | Amber tinted backgrounds                                        |
| `--color-accent-border`                  | amber @ 40%               | Amber outlines (accent badge)                                   |
| `--color-on-accent`                      | `#050A18`                 | Text on amber                                                   |
| `--color-text`                           | `#EAF0F7` off-white       | Headings and body                                               |
| `--color-text-muted`                     | `#9AABC7` grey-blue       | Secondary text, captions, labels                                |
| `--color-focus`                          | amber                     | Focus outlines (set globally on `:focus-visible`)               |
| `--color-bg-translucent`                 | bg @ 80%                  | Sticky navbar behind the blur                                   |
| `--color-scrim` / `--color-scrim-strong` | bg-deep @ 55% / 85%       | Overlays and label backings on top of graphics                  |

The `@ n%` tokens are built with `color-mix()` from the raw palette, so changing a base colour updates its tints too. Never write `rgb(… / alpha)` in component CSS; add or use one of these tokens instead.

**Contrast (WCAG 2.1):**

| Text                 | on bg  | on bg-deep | on surface | on surface-raised |
| -------------------- | ------ | ---------- | ---------- | ----------------- |
| `--color-text`       | 17.2:1 | 17.7:1     | 16.0:1     | 14.8:1            |
| `--color-text-muted` | 8.5:1  | 8.7:1      | 7.9:1      | 7.3:1             |
| `--color-primary`    | 9.9:1  | 10.1:1     | 9.2:1      | 8.5:1             |
| `--color-accent`     | 10.5:1 | 10.8:1     | 9.8:1      | 9.0:1             |

Navy on teal is 9.9:1 (12.3:1 on hover), and navy on amber is 10.5:1 (12.5:1 on hover). Teal text on `--color-primary-soft` is at least 7.1:1, and amber text on `--color-accent-soft` is 7.6:1. Every text pair passes AA, and nearly all pass AAA. The 1px borders (about 1.3:1) are decorative separators. Don't rely on a border alone to show that something is a control or what state it is in; use a fill, an icon or text as well.

Dither palette, read at runtime by `DitherCanvas`: `--dither-bg` (`#050A18`, must equal `--color-bg` so canvases have no visible edge), `--dither-mid` (`#1A2640`), `--dither-fg` (teal `#2CCDB4`), `--dither-accent` (amber).

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

- `variant`: `primary` is amber, for the **one** main action per view. `secondary` is teal (the default). `ghost` is low emphasis.
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

Small mono pill. `tone`: `neutral` | `primary` (teal: safe, positive) | `accent` (amber: target only). `dot` adds a status dot.

### NavBar, Footer, Layout, Logo

`Layout` is the shared page shell (NavBar, `<main id="main">`, Footer). It is a router layout route in `src/App.tsx`, so every page inside it gets the shell. It also handles `/#section` hash links and scroll-to-top on navigation. `NavBar` takes `links` and `action`. Nav links and team names live in `src/components/siteConfig.ts`. `Logo` renders `public/logo-on-dark.png`, a transparent version of `public/logo.png` for navy backgrounds.

### Reveal

Wrap a block to fade it in on scroll: `<Reveal delay={100}>…</Reveal>`. It does nothing under reduced motion. Use it on marketing pages, not in tool UI.

### DitherCanvas

A three.js scene drawn through an ordered (Bayer) dither post-process in the theme palette.

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
  const target = new THREE.Mesh(new THREE.SphereGeometry(0.1), createMarkerMaterial("accent"));
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

How it works: the scene renders into a low-resolution target (2×2 samples per dither cell). A full-screen shader then takes each cell's luminance and thresholds it against a 4×4 or 8×8 Bayer matrix into `bg` → `mid` → `fg`. Cells are `pixelSize` CSS pixels, scaled by `devicePixelRatio` and rounded, so they stay square and crisp on retina screens. The 3D work runs at a fraction of full resolution, which keeps it at 60 fps. The loop pauses when the canvas is off-screen or the tab is hidden. With reduced motion it draws a single still frame.

**Colouring things.** Shade ordinary objects with neutral (grey/white) lit materials; brightness becomes the dither pattern. To force a palette colour, use the marker helpers:

- `createMarkerMaterial("primary")` draws solid teal. Use it for needles, paths and scan planes.
- `createMarkerMaterial("accent")` draws solid amber. Use it for targets/lesions only.
- `ditherMarkerColor(kind, intensity)` fades a marker (it dithers out). `createGlowSprite(kind, size)` makes a soft dithered halo.

Props: `setup`, `pixelSize` (default 3), `levels` (2 or 3), `matrix` (4 or 8), `palette` (override any of `bg`/`mid`/`fg`/`accent` with a theme variable name, e.g. `{ fg: "--color-text" }`), `contrast`, `brightness`, `paused`, `label` (set it for meaningful images, leave it off for decorative ones), `className`, `style`. The element fills its container, so give it a size.

The landing hero (`src/pages/landing/HeroAnatomy.tsx`) shows a full example. It also takes real pipeline meshes:

```tsx
<HeroAnatomy
  models={{
    ribs: "/cases/case01/ribs.glb",
    lungs: "/cases/case01/lungs.glb",
    lesion: "/cases/case01/lesion.glb",
  }}
  needle={{ entry: [x, y, z], target: [x, y, z] }} // mm, from meta.json
/>
```

The models are rotated from CT patient space (LPS) to three.js y-up, centred and scaled to fit. If they fail to load, the procedural meshes stay.

---

## Building `/planner` with the theme

- Replace `src/pages/Planner.tsx` (currently a placeholder). It is lazy-loaded, so its code doesn't weigh down the landing page.
- It already renders inside `Layout`. For a full-screen tool without the footer, move its route into its own `<Route element={<Layout hideFooter />}>` group in `src/App.tsx` (ask Ibrahim, since `App.tsx` is shared).
- Tool chrome: put side panels and controls in `Panel`, and the 3D viewport and CT slice view in `Panel variant="inset" padding="none"`. Use `SectionHeader as="h3"` or plain `h3` for panel titles, `Toggle` for layer visibility (skin, ribs, vessels…), and `Badge` for status.
- Numbers, units and coordinates use `.pf-mono`.
- The safest path and the user's needle are **teal**. The lesion/target is **amber**. The one big action (e.g. "Find safest path") is the amber `primary` button; everything else is `secondary` or `ghost`.
- The planner's main 3D view doesn't need to be dithered. A normal three.js renderer on `--color-bg-deep`, with materials coloured from the tokens, matches the brand. To read a token in JS: `getComputedStyle(document.documentElement).getPropertyValue("--color-primary")`.
- **Open question:** the risk heat map (safe-zone skin map) will need a colour scale. Teal-to-amber clashes with "amber = target", and there is no danger colour yet. Agree a scale with Ibrahim before adding one.
