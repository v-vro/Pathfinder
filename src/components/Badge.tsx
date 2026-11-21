import type { HTMLAttributes, ReactNode } from "react";
import "./components.css";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** neutral: info. primary: teal, positive / safe. accent: amber, target or highlight only. */
  tone?: "neutral" | "primary" | "accent";
  /** Show a small status dot before the text. */
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={["pf-badge", `pf-badge--${tone}`, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {dot && <span className="pf-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
