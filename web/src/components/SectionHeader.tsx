import type { ReactNode } from "react";
import "./components.css";

export interface SectionHeaderProps {
  /** Small mono label above the title, e.g. "01 / The problem". */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  align?: "start" | "center";
  /** Heading level. Use h1 once per page. */
  as?: "h1" | "h2" | "h3";
  id?: string;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "start",
  as: Heading = "h2",
  id,
  className,
}: SectionHeaderProps) {
  return (
    <header
      className={["pf-section-header", `pf-section-header--${align}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {eyebrow && <p className="pf-section-header__eyebrow pf-mono">{eyebrow}</p>}
      <Heading id={id} className="pf-section-header__title">
        {title}
      </Heading>
      {description && <p className="pf-section-header__description">{description}</p>}
    </header>
  );
}
