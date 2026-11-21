import type { ReactNode } from "react";
import { RISK_ICON_PATHS, RISK_WORD, type RiskLevel } from "./riskIcons";
import "./components.css";

export type { RiskLevel };

export interface RiskLabelProps {
  level: RiskLevel;
  /** Replaces the default word ("Safe", "Caution", "Danger"). Keep it meaningful without colour. */
  children?: ReactNode;
  /** Icon only, with the word kept for screen readers. Use only when the meaning is clear from context. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * The only way risk colours should appear in UI: colour + icon + word, so the meaning
 * never depends on telling red from green.
 */
export function RiskLabel({ level, children, iconOnly, className }: RiskLabelProps) {
  const text = children ?? RISK_WORD[level];
  return (
    <span className={["pf-risk", `pf-risk--${level}`, className].filter(Boolean).join(" ")}>
      <svg
        className="pf-risk__icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {RISK_ICON_PATHS[level].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      <span className={iconOnly ? "pf-visually-hidden" : undefined}>{text}</span>
    </span>
  );
}
