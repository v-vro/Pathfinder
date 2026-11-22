import { useEffect, useMemo, useRef } from "react";
import { DitherCanvas } from "../../components/DitherCanvas";
import {
  createAnatomyScene,
  createHeroScene,
  type AnatomyModels,
  type Vec3,
} from "./scenes/anatomy";
import { FIRST_INTERACTION_EVENT } from "./scenes/heroControls";

export interface HeroAnatomyProps {
  /**
   * Swap the procedural meshes for real pipeline output, e.g.
   * { ribs: "/cases/case01/ribs.glb", lungs: "/cases/case01/lungs.glb" }
   */
  models?: AnatomyModels;
  /** Poster only: needle entry and target in model space (mm), e.g. from meta.json. */
  needle?: { entry: Vec3; target: Vec3 };
  pixelSize?: number;
  /**
   * hero: interactive anatomy only (mouse-follow, drag, zoom, idle spin).
   * poster: slowly swaying anatomy with a needle, for the demo poster frame.
   */
  view?: "hero" | "poster";
  /** Poster only: colour the needle path with the risk markers. */
  riskPreview?: boolean;
  /** Hero only: called once on the first deliberate interaction. */
  onFirstInteraction?: () => void;
  className?: string;
  label?: string;
}

export function HeroAnatomy({
  models,
  needle,
  pixelSize = 3,
  view = "hero",
  riskPreview = false,
  onFirstInteraction,
  className,
  label,
}: HeroAnatomyProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // The hero controls announce the first interaction with a bubbling DOM event.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !onFirstInteraction) return;
    el.addEventListener(FIRST_INTERACTION_EVENT, onFirstInteraction);
    return () => el.removeEventListener(FIRST_INTERACTION_EVENT, onFirstInteraction);
  }, [onFirstInteraction]);

  // Rebuild the scene only when the inputs actually change.
  const key = JSON.stringify({ models, needle, view, riskPreview });
  const setup = useMemo(() => {
    const opts = JSON.parse(key) as {
      models?: AnatomyModels;
      needle?: { entry: Vec3; target: Vec3 };
      view: "hero" | "poster";
      riskPreview: boolean;
    };
    return opts.view === "hero"
      ? createHeroScene({ models: opts.models })
      : createAnatomyScene(opts);
  }, [key]);

  const defaultLabel =
    view === "hero"
      ? "Stylised 3D ribcage and lungs. A blue needle tries routes to a target. Move the mouse to tilt, drag to spin, scroll to zoom."
      : "Stylised 3D ribcage and lungs with a needle aimed at a target.";

  return (
    <div ref={wrapRef} className={className}>
      <DitherCanvas
        setup={setup}
        pixelSize={pixelSize}
        style={{ position: "absolute", inset: 0 }}
        label={label ?? defaultLabel}
      />
    </div>
  );
}
