import { useMemo } from "react";
import { DitherCanvas } from "../../components/DitherCanvas";
import { createAnatomyScene, type AnatomyModels, type Vec3 } from "./scenes/anatomy";

export interface HeroAnatomyProps {
  /**
   * Swap the procedural meshes for real pipeline output, e.g.
   * { ribs: "/cases/case01/ribs.glb", lungs: "/cases/case01/lungs.glb", lesion: "/cases/case01/lesion.glb" }
   */
  models?: AnatomyModels;
  /** Needle entry and target in model space (mm), e.g. from meta.json's best path. */
  needle?: { entry: Vec3; target: Vec3 };
  pixelSize?: number;
  view?: "hero" | "poster";
  className?: string;
  label?: string;
}

/** Dithered, slowly rotating ribcage + lungs with a needle path to a pulsing target. */
export function HeroAnatomy({
  models,
  needle,
  pixelSize = 3,
  view = "hero",
  className,
  label = "Stylised 3D ribcage and lungs. A teal needle path enters between two ribs and ends at a pulsing amber target.",
}: HeroAnatomyProps) {
  // Rebuild the scene only when the inputs actually change.
  const key = JSON.stringify({ models, needle, view });
  const setup = useMemo(
    () => createAnatomyScene(JSON.parse(key) as Parameters<typeof createAnatomyScene>[0]),
    [key],
  );
  return <DitherCanvas setup={setup} pixelSize={pixelSize} className={className} label={label} />;
}
