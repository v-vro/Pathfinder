import type { ReactNode } from "react";
import "./components.css";

export type RiskLevel = "safe" | "caution" | "danger";

const TEXT: Record<RiskLevel, string> = { safe: "Safe", caution: "Caution", danger: "Danger" };

const ICON: Record<RiskLevel, ReactNode> = {
  // check
  safe: <path d="M3.5 8.5l3 3 6-7" />,
  // warning triangle with "!"
  caution: (
    <>
      <path d="M8 2.2l6.2 11H1.8z" />
      <path d="M8 6.5v3M8 11.4v.1" />
    </>
  ),
  // cross
  danger: <path d="M4 4l8 8M12 4l-8 8" />,
};

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
  const text = children ?? TEXT[level];
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
        {ICON[level]}
      </svg>
      <span className={iconOnly ? "pf-visually-hidden" : undefined}>{text}</span>
    </span>
  );
}
