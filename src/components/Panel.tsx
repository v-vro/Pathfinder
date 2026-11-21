import type { ElementType, HTMLAttributes, ReactNode } from "react";
import "./components.css";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** default: surface card. raised: lighter, for panels on panels. inset: recessed, for wells and viewports. */
  variant?: "default" | "raised" | "inset";
  padding?: "none" | "sm" | "md" | "lg";
  /** Adds hover lift and border highlight. Use on clickable cards. */
  interactive?: boolean;
  as?: ElementType;
  children?: ReactNode;
}

export function Panel({
  variant = "default",
  padding = "md",
  interactive,
  as: Tag = "div",
  className,
  children,
  ...rest
}: PanelProps) {
  const classes = [
    "pf-panel",
    `pf-panel--${variant}`,
    `pf-panel--pad-${padding}`,
    interactive && "pf-panel--interactive",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
