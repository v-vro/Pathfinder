/**
 * Risk icon shapes (16x16 viewBox, stroked with currentColor). Shared by <RiskLabel>
 * and by DOM labels built outside React (e.g. the landing hero's 3D path labels).
 */
export type RiskLevel = "safe" | "caution" | "danger";

export const RISK_WORD: Record<RiskLevel, string> = {
  safe: "Safe",
  caution: "Caution",
  danger: "Danger",
};

/** SVG path data per level: check, warning triangle with "!", cross. */
export const RISK_ICON_PATHS: Record<RiskLevel, string[]> = {
  safe: ["M3.5 8.5l3 3 6-7"],
  caution: ["M8 2.2l6.2 11H1.8z", "M8 6.5v3M8 11.4v.1"],
  danger: ["M4 4l8 8M12 4l-8 8"],
};

/** Complete inline SVG markup for a risk icon (constant strings only). */
export function riskIconSvg(level: RiskLevel, className = ""): string {
  const paths = RISK_ICON_PATHS[level].map((d) => `<path d="${d}"/>`).join("");
  return `<svg class="${className}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
